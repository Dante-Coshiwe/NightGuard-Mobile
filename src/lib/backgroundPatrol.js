import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { hasCoordinates } from './geo';
import { getPatrolConfig } from './deviceStore';
import { buildPatrolScanEntry, evaluateGpsProgress } from './patrolCheckin';
import { persistPatrolScan } from './patrolScanStore';
import { QUEUE_WRITE_FAILED_EVENT } from '../hooks/useOfflineQueue';
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

// Last fix handed over by a drain, so the segment test spans drain boundaries: a guard who steps
// over a checkpoint between two 15 s drains is still credited. Cleared whenever a patrol starts or
// stops, because a previous walk's last position must never be treated as this walk's previous fix
// — that would draw a segment across everything in between and credit points nobody passed.
let lastDrainedFix = null;

// Only one drain at a time. The drain is fired from a 15 s interval AND from visibilitychange AND
// from End Patrol, and every one of those can land while an earlier drain is still awaiting a
// persist — which posts the same checkpoint twice and, worse, lets two drains interleave on
// lastDrainedFix and alreadyReached. Skipping is free: peek() consumes nothing, so whatever this
// call would have handled is still in the native buffer for the drain that is already running, or
// for the next one.
let draining = false;

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
    lastDrainedFix = null;
    await PatrolTracker.start({ patrolId: patrolId ? String(patrolId) : null, checkpoints });
    console.info(`[BackgroundPatrol] tracking started for ${checkpoints.length} checkpoint(s)`);
    return true;
  } catch (err) {
    console.warn('[BackgroundPatrol] start failed, falling back to in-app watch:', err?.message || err);
    return false;
  }
}

export async function stopBackgroundPatrol() {
  lastDrainedFix = null;
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
  if (draining) return result;
  draining = true;

  // ⚠ A FAILED OUTBOX WRITE IS SILENT. persistPatrolScan() resolves normally when the queue could
  // not be saved — saveQueue() catches the quota error, raises the "Storage is full" banner and
  // returns false; it does not throw. Crediting on that resolve marks a checkpoint reached that is
  // on no disk anywhere, and for a native capture acknowledges it out of the buffer as well: the
  // guard is told the point was gathered and nothing is holding it.
  //
  // Verified by test rather than assumed — with storage refusing every write, persistPatrolScan()
  // returned an ordinary offline response. This event is the only signal that it did not land.
  let queueWriteFailed = false;
  const onQueueWriteFailed = () => { queueWriteFailed = true; };
  window.addEventListener(QUEUE_WRITE_FAILED_EVENT, onQueueWriteFailed);
  try {
    return await runDrain({ post, context, result, failed: () => queueWriteFailed });
  } finally {
    window.removeEventListener(QUEUE_WRITE_FAILED_EVENT, onQueueWriteFailed);
    draining = false;
  }
}

async function runDrain({ post, context, result, failed }) {

  // ⚠ CRUCIAL DATA PATH — this is how a walk done with the screen off reaches the server, and it
  // is the ONLY copy while it is in flight.
  //
  // TWO-PHASE HANDOVER. The native buffer is read with peek(), which consumes nothing; only once
  // the route is on the session and the captures are through persistPatrolScan() do we
  // acknowledge() exactly what was stored, and only then does the native side drop it.
  //
  // The single-step drain() this replaces returned the walk and cleared it together, so from that
  // return until persistPatrolScan() had written, the walk existed only in a local variable — a
  // kill there lost it outright, on the one path built for a phone in a pocket where a kill is
  // expected rather than exceptional.
  //
  // The trade is deliberate: at-least-once instead of at-most-once. A kill before the
  // acknowledgement re-delivers the same points next time, which the dedupe below (and
  // appendRoutePoint's own distance/time thinning) absorbs. A duplicated point is a cosmetic
  // problem; a lost patrol is a hole in a security record.
  //
  // peek/acknowledge exist only on APK 1.24 and newer. An older shell has drain() alone, so it is
  // feature-detected rather than assumed — this bundle must keep working on every handset in the
  // field, not just the freshly flashed ones.
  // See README.md, "Data capture and upload", risk 2.
  const twoPhase = typeof PatrolTracker.peek === 'function'
    && typeof PatrolTracker.acknowledge === 'function';

  let drained;
  try {
    drained = twoPhase ? await PatrolTracker.peek() : await PatrolTracker.drain();
  } catch (err) {
    console.warn('[BackgroundPatrol] drain failed:', err?.message || err);
    return result;
  }

  const route = Array.isArray(drained?.route) ? drained.route : [];
  const captures = Array.isArray(drained?.captures) ? drained.captures : [];

  // appendRoutePoint writes into the ACTIVE session and returns null when there is none, so
  // without a session these points land nowhere. That has always been true — this function is
  // documented as having to run before the session ends — but under the two-phase handover it
  // matters more: acknowledging what was never stored would delete it for real.
  const hasSession = Boolean(getActivePatrolSession());
  if (hasSession) {
    route.forEach((point) => {
      appendRoutePoint({
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        timestamp: point.at,
      });
    });
    result.routePoints = route.length;
  } else if (route.length) {
    console.warn(`[BackgroundPatrol] no active session — discarding ${route.length} orphaned route point(s)`);
  }

  // Belt and braces alongside the Array.isArray guard in getPatrolConfig(): this runs on a 15s
  // interval with no catch, so anything that throws here takes checkpoint crediting down for the
  // whole patrol without a word on screen. A drain that credits nothing must still drain.
  const storedCheckpoints = getPatrolConfig().checkpoints;
  const configured = Array.isArray(storedCheckpoints) ? storedCheckpoints : [];
  // The session is the single source of truth for what this patrol has already credited. Belt and
  // braces against the in-app watch having logged the same point: a checkpoint reaches the report
  // once, however many recorders saw the guard standing on it.
  const alreadyReached = new Set(
    (getActivePatrolSession()?.reachedCheckpointIds || []).map(String)
  );

  // Counts the LEADING captures that are safely dealt with, because acknowledge() drops from the
  // head. The first genuine failure stops the count and the loop: everything from there stays in
  // the native buffer and comes back on the next drain, which is the whole point of two-phase.
  let handledCaptures = 0;

  // ⚠ DO NOT rely on `captures` alone to credit a checkpoint.
  //
  // The native recorder matches checkpoints itself and hands them over in `captures`. When that
  // works it is the better signal — it carries the exact fix that satisfied the fence, including
  // fixes the thinning rule keeps out of the route. But it is the half of the system this bundle
  // cannot fix: it runs in the APK, and on any shell older than 1.33 the service holds its buffer
  // in a long-lived field and rewrites it on every fix, so what acknowledge() trims comes back and
  // the capture list does not behave.
  //
  // Measured on Fountainbrook's 2026-09-16 night (APK 1.32, bundle 1.1.38): the guard walked
  // within 3.6 m of Point 8 for four consecutive fixes and it was never credited. Replaying that
  // patrol's OWN recorded route through evaluateGpsProgress() credits 7 of 9 checkpoints; the
  // native capture list produced 1. The nine nights before it, on identical code, averaged 9.0.
  //
  // So the route is matched here as well. The trail is already proof of where the guard walked —
  // it is the same evidence, through the same rules the in-app watch uses (geo.js), and a
  // checkpoint credited by either route reaches the report exactly once because both paths
  // dedupe through `alreadyReached` and the session's reachedCheckpointIds.
  //
  // This is deliberately ADDITIVE. Native captures are still processed first and still
  // acknowledged normally — nothing here changes the two-phase handover or what the native side
  // is allowed to drop.
  const routeMatches = [];
  if (hasSession && route.length) {
    const seen = new Set(alreadyReached);
    for (const point of route) {
      const fix = {
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        timestamp: point.at,
      };
      // Continuity across drains: the last fix of the previous batch is the `previousFix` of this
      // one, so a checkpoint stepped over between two drains is still caught by the segment test.
      const newly = evaluateGpsProgress(configured, lastDrainedFix, fix, [...seen]);
      for (const checkpoint of newly) {
        seen.add(String(checkpoint.id));
        routeMatches.push({ checkpoint, fix });
      }
      lastDrainedFix = fix;
    }
  }

  for (const capture of captures) {
    if (alreadyReached.has(String(capture.checkpointId))) {
      handledCaptures += 1;
      continue;
    }

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

    try {
      await persistPatrolScan(entry, post);
      // The outbox write itself failed. Leave it buffered AND uncredited so the native side
      // re-delivers it: acknowledging here would delete the only copy.
      if (failed()) {
        console.warn('[BackgroundPatrol] outbox write failed; leaving capture buffered and uncredited');
        break;
      }
      // Credited only AFTER it is stored. Marking first (as this used to) meant a failed persist
      // was skipped as "already reached" on the retry, so the two-phase handover would have
      // acknowledged and deleted a scan that was never saved anywhere.
      markCheckpointReached(capture.checkpointId);
      alreadyReached.add(String(capture.checkpointId));
      result.captures += 1;
      handledCaptures += 1;
    } catch (err) {
      console.warn('[BackgroundPatrol] capture not persisted, leaving it buffered:', err?.message || err);
      break;
    }
  }

  // Phase two. Only now — with the route on the session and the captures through the outbox — does
  // the native side let go. A failure here is safe by construction: nothing is deleted, so the
  // same items are handed over again next time.
  if (twoPhase) {
    try {
      await PatrolTracker.acknowledge({ routeCount: route.length, captureCount: handledCaptures });
    } catch (err) {
      console.warn('[BackgroundPatrol] acknowledge failed; buffer will be re-drained:', err?.message || err);
    }
  }

  // Route-derived checkpoints. Deliberately AFTER acknowledge(): these are reconstructed from the
  // trail, which is already stored on the session, so nothing here is the last copy of anything and
  // a failure must not hold up the native buffer. Re-checked against `alreadyReached` because the
  // capture loop above has been adding to it — a point the native side credited is not credited
  // twice.
  for (const { checkpoint, fix } of routeMatches) {
    if (alreadyReached.has(String(checkpoint.id))) continue;

    const entry = buildPatrolScanEntry({
      method: 'gps',
      position: { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
      matchedCheckpoint: checkpoint,
      scannedAt: new Date(fix.timestamp).toISOString(),
      ...context,
    });

    try {
      await persistPatrolScan(entry, post);
      if (failed()) {
        console.warn('[BackgroundPatrol] outbox write failed; leaving route-matched checkpoint uncredited');
        break;
      }
      markCheckpointReached(checkpoint.id);
      alreadyReached.add(String(checkpoint.id));
      result.captures += 1;
    } catch (err) {
      // Left uncredited rather than marked: markCheckpointReached() runs only after a successful
      // persist, so the next drain re-derives this same checkpoint from the trail and tries again.
      console.warn('[BackgroundPatrol] route-matched checkpoint not persisted:', err?.message || err);
    }
  }

  if (result.routePoints || result.captures) {
    console.info(`[BackgroundPatrol] drained ${result.routePoints} route point(s), ${result.captures} capture(s)`);
  }
  return result;
}
