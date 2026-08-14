import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { hasCoordinates } from './geo';
import { getPatrolConfig } from './deviceStore';
import { buildPatrolScanEntry } from './patrolCheckin';
import { persistPatrolScan } from './patrolScanStore';
import { appendRoutePoint, getActivePatrolSession, markCheckpointReached } from './patrolSession';

// Background patrol recording — the native half lives in PatrolTrackingService.java.
//
// Android stops the WebView's timers and GPS watch once the display sleeps, so a patrol walked
// with the phone in a pocket recorded nothing until the guard woke the screen. The tracking shell
// records natively instead: it matches checkpoints itself (same rules as geo.js), pings the guard
// the moment a point is captured, and buffers everything to disk. This module is the handover
// point — it drains that buffer into the ordinary patrol session and offline queue.
//
// IMPORTANT: the same web bundle also runs on installs whose native shell has no such plugin
// (every device in the field before this build). Every call here is feature-detected and failure
// tolerant: without the plugin the app simply keeps using the in-app GPS watch, which is why
// nothing in the patrol flow may depend on this succeeding.

const PatrolTracker = registerPlugin('PatrolTracker');

export function isBackgroundPatrolAvailable() {
  try {
    if (!Capacitor.isNativePlatform?.()) return false;
    return Capacitor.isPluginAvailable?.('PatrolTracker') === true;
  } catch {
    return false;
  }
}

// The service only needs the GPS checkpoints and enough to name them in a notification.
function nativeCheckpoints() {
  return getPatrolConfig().checkpoints
    .filter(hasCoordinates)
    .map((checkpoint) => ({
      id: String(checkpoint.id),
      name: checkpoint.name || checkpoint.checkpoint_name || 'Checkpoint',
      zone: checkpoint.zone || null,
      tagUid: checkpoint.tag_uid || null,
      latitude: Number(checkpoint.latitude),
      longitude: Number(checkpoint.longitude),
    }));
}

// The native recorder is a foreground service of type `location`, and Android 14+ refuses to start
// one unless a location permission is already held — so the grant has to happen here, before the
// plugin call, rather than lazily whenever the in-app watch first reads a position. Fine location
// specifically: the ~3 m geofence cannot be judged from an approximate fix.
//
// Nothing races with this. PatrolRecorder keeps the in-app watch off until this function has
// answered, so its own permission request cannot be in flight at the same time.
async function ensureLocationPermission() {
  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted') return true;
    const requested = await Geolocation.requestPermissions();
    return requested.location === 'granted';
  } catch (err) {
    console.warn('[BackgroundPatrol] permission check failed:', err?.message || err);
    return false;
  }
}

// Returns true only when the service actually took the job, so the caller knows whether it still
// needs the in-app GPS watch as the recorder.
export async function startBackgroundPatrol(patrolId) {
  if (!isBackgroundPatrolAvailable()) return false;
  const checkpoints = nativeCheckpoints();
  if (!checkpoints.length) return false;
  if (!(await ensureLocationPermission())) {
    console.warn('[BackgroundPatrol] location not granted; falling back to in-app watch');
    return false;
  }

  try {
    await PatrolTracker.start({ patrolId: patrolId ? String(patrolId) : null, checkpoints });
    console.info(`[BackgroundPatrol] tracking started for ${checkpoints.length} checkpoint(s)`);
    return true;
  } catch (err) {
    console.warn('[BackgroundPatrol] start failed, falling back to in-app watch:', err?.message || err);
    return false;
  }
}

export async function stopBackgroundPatrol() {
  if (!isBackgroundPatrolAvailable()) return;
  try {
    await PatrolTracker.stop();
  } catch (err) {
    console.warn('[BackgroundPatrol] stop failed:', err?.message || err);
  }
}

export async function backgroundPatrolStatus() {
  if (!isBackgroundPatrolAvailable()) return null;
  try {
    return await PatrolTracker.status();
  } catch {
    return null;
  }
}

/**
 * Take everything the service recorded and fold it into the active patrol session: route points
 * onto the trail, captured checkpoints through the normal scan pipeline (which persists locally
 * first and queues the upload).
 *
 * Must run BEFORE the session is ended — appendRoutePoint has no session to write to afterwards,
 * and the walked route would be dropped from the completion payload.
 *
 * No notification is raised here: the service already pinged the guard at the point itself, and
 * announcing it again on reopen would be a second alert for something that happened an hour ago.
 */
export async function drainBackgroundPatrol({ post, context = {} } = {}) {
  const result = { routePoints: 0, captures: 0 };
  if (!isBackgroundPatrolAvailable() || typeof post !== 'function') return result;

  // ⚠ CRUCIAL DATA PATH — this is how a walk done with the screen off reaches the server, and it
  // is the ONLY copy while it is in flight.
  //
  // PatrolBuffer.drain() returns the route and captures AND CLEARS THEM in the same locked step,
  // so from here until persistPatrolScan() has written them, the walk exists only in the local
  // `drained` variable. A process kill in that window loses it: it is already gone natively and
  // was never handed to the outbox. This is at-most-once delivery on the one path built for a
  // phone in a pocket, where a kill is expected rather than exceptional.
  //
  // The fix is a two-phase drain (hand over → JS persists → acknowledge → clear), NOT removing the
  // clear: without one, every drain re-delivers the whole walk and the trail duplicates.
  // See README.md, "Data capture and upload", risk 2.
  let drained;
  try {
    drained = await PatrolTracker.drain();
  } catch (err) {
    console.warn('[BackgroundPatrol] drain failed:', err?.message || err);
    return result;
  }

  const route = Array.isArray(drained?.route) ? drained.route : [];
  const captures = Array.isArray(drained?.captures) ? drained.captures : [];

  route.forEach((point) => {
    appendRoutePoint({
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
      timestamp: point.at,
    });
  });
  result.routePoints = route.length;

  const configured = getPatrolConfig().checkpoints;
  // The session is the single source of truth for what this patrol has already credited. Belt and
  // braces against the in-app watch having logged the same point: a checkpoint reaches the report
  // once, however many recorders saw the guard standing on it.
  const alreadyReached = new Set(
    (getActivePatrolSession()?.reachedCheckpointIds || []).map(String)
  );

  for (const capture of captures) {
    if (alreadyReached.has(String(capture.checkpointId))) continue;
    alreadyReached.add(String(capture.checkpointId));

    const matched = configured.find((cp) => String(cp.id) === String(capture.checkpointId)) || {
      id: capture.checkpointId,
      name: capture.checkpointName,
      zone: capture.zone,
      tag_uid: capture.tagUid,
    };

    const entry = buildPatrolScanEntry({
      method: 'gps',
      position: {
        latitude: capture.latitude,
        longitude: capture.longitude,
        accuracy: capture.accuracy,
      },
      matchedCheckpoint: matched,
      scannedAt: new Date(capture.at).toISOString(),
      ...context,
    });

    markCheckpointReached(capture.checkpointId);
    try {
      await persistPatrolScan(entry, post);
      result.captures += 1;
    } catch (err) {
      // persistPatrolScan already wrote it to the device; the queue owns delivery from here.
      console.warn('[BackgroundPatrol] capture handover warning:', err?.message || err);
    }
  }

  if (result.routePoints || result.captures) {
    console.info(`[BackgroundPatrol] drained ${result.routePoints} route point(s), ${result.captures} capture(s)`);
  }
  return result;
}
