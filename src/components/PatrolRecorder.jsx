import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGeolocation } from '../hooks/useGeolocation';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { isAppOnline } from '../lib/connectivity';
import { getCachedSiteSettings, getPatrolConfig, getShiftSession } from '../lib/deviceStore';
import { getBoundSiteIdSync } from '../lib/siteResolver';
import { buildPatrolScanEntry, evaluateGpsProgress, matchNfcCheckpoint } from '../lib/patrolCheckin';
import { listenForNfcTags } from '../lib/nfcReader';
import { persistPatrolScan } from '../lib/patrolScanStore';
import { releaseScreenWakeLock, requestScreenWakeLock } from '../lib/screenWakeLock';
import {
  appendRoutePoint,
  closeAbandonedPatrolSession,
  flushPendingPatrolCompletions,
  getActivePatrolSession,
  markCheckpointReached,
  PATROL_SESSION_EVENT,
} from '../lib/patrolSession';
import { syncOfflineQueueNow } from '../hooks/useOfflineQueue';
import {
  drainBackgroundPatrol,
  isBackgroundPatrolAvailable,
  startBackgroundPatrol,
  stopBackgroundPatrol,
} from '../lib/backgroundPatrol';
import NotificationService from '../services/notificationService';

// Records the patrol for as long as a session is active, wherever the guard is in the app.
//
// The GPS watch used to live inside the Patrol tab, so it stopped the instant the guard switched
// to Vehicles, OB or Incidents — the session stayed "active" and the screen kept promising the
// patrol was still running, but no route points and no automatic check-ins were captured until
// they navigated back. Most sites are GPS-only, so for those that silently threw away the walk.
//
// Mounted once inside the authenticated layout; renders nothing.
export default function PatrolRecorder() {
  const { user, shiftSession } = useAuth() || {};
  const { post } = useOfflineApi();
  const geo = useGeolocation();

  const [patrolActive, setPatrolActive] = useState(() => Boolean(getActivePatrolSession()));
  // Whether this shell has the native tracking service at all — known synchronously, which is what
  // lets the in-app watch stay off from the very first render on a capable device.
  const backgroundCapable = isBackgroundPatrolAvailable();
  // Tri-state: null = the native service has not answered yet, true = it took the job,
  // false = it refused (no permission, no GPS checkpoints) and the in-app watch must cover.
  //
  // This MUST NOT default to false on a capable shell: doing so ran the in-app watch for the few
  // hundred milliseconds before the service answered, and a guard who starts a patrol while
  // standing at the first checkpoint had that point logged twice — once by each recorder.
  const [nativeStarted, setNativeStarted] = useState(null);
  // Derived rather than stored: ending a patrol drops straight back to the in-app watch without
  // another state write, and a stale "started" can never outlive the patrol it belonged to.
  const nativeTracking = patrolActive && nativeStarted === true;
  // The in-app watch is the recorder only where the native service cannot be.
  const useInAppWatch = !backgroundCapable || nativeStarted === false;

  // Raw previous fix (not the thinned route point) so the walked segment between two consecutive
  // readings stays continuous, and the in-flight set so a slow submit can't double-log a point.
  const previousFixRef = useRef(null);
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    const sync = () => setPatrolActive(Boolean(getActivePatrolSession()));
    sync();
    window.addEventListener(PATROL_SESSION_EVENT, sync);
    window.addEventListener('nightguard_patrol_history_updated', sync);
    return () => {
      window.removeEventListener(PATROL_SESSION_EVENT, sync);
      window.removeEventListener('nightguard_patrol_history_updated', sync);
    };
  }, []);

  // Recovery pass on launch: close a patrol the app was killed in the middle of, then hand every
  // completion that never made it to the network over to the offline queue. Without this, a
  // process kill between "End Patrol" and the POST lost the patrol and its whole route.
  useEffect(() => {
    closeAbandonedPatrolSession();
    if (flushPendingPatrolCompletions() > 0) {
      syncOfflineQueueNow().catch(() => null);
    }
    setPatrolActive(Boolean(getActivePatrolSession()));
  }, []);

  const logCheckpoint = useCallback(async (checkpoint, fix) => {
    const id = String(checkpoint.id);
    if (inFlightRef.current.has(id)) return;
    inFlightRef.current.add(id);

    try {
      markCheckpointReached(checkpoint.id);
      const entry = buildPatrolScanEntry({
        method: 'gps',
        position: fix,
        matchedCheckpoint: checkpoint,
        siteId: getBoundSiteIdSync() || getCachedSiteSettings().id || null,
        guardId: user?.id || null,
        guardName: user?.full_name || 'Unknown guard',
        shiftId: shiftSession?.id || getShiftSession()?.id || null,
        shiftLabel: shiftSession?.shiftLabel || 'On Duty',
        patrolId: getActivePatrolSession()?.id || null,
        isOnline: isAppOnline(),
      });

      await persistPatrolScan(entry, post);
      NotificationService.announceCheckpointCaptured(entry.checkpoint_name, {
        shiftId: entry.shift_id,
        checkpointId: entry.checkpoint_id,
        method: 'gps',
      }).catch(() => null);
    } catch (err) {
      console.warn('[PatrolRecorder] checkpoint log failed:', err?.message || err);
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [post, user, shiftSession]);

  // A tag held against the phone counts on its own — there is no button to press and nothing to
  // type. Lives here rather than in the Patrol tab so a tag read while the guard is on any other
  // screen still registers.
  //
  // Offline is the normal case, not the exception: persistPatrolScan writes the scan to the device
  // before any network call, so a tag read with no signal is already saved and the queue delivers
  // it later.
  const logNfcTag = useCallback(async (tagUid) => {
    const session = getActivePatrolSession();
    if (!session) return;

    const checkpoints = getPatrolConfig().checkpoints;
    const matchedCheckpoint = matchNfcCheckpoint(checkpoints, tagUid);
    // An unmatched tag is still recorded (it proves the guard was there and shows up as an
    // unregistered scan), but it must not be de-duplicated against a checkpoint id it has none of.
    const id = matchedCheckpoint ? String(matchedCheckpoint.id) : `tag:${tagUid}`;
    if (inFlightRef.current.has(id)) return;
    if (matchedCheckpoint && (session.reachedCheckpointIds || []).map(String).includes(id)) return;
    inFlightRef.current.add(id);

    try {
      if (matchedCheckpoint) markCheckpointReached(matchedCheckpoint.id);
      const entry = buildPatrolScanEntry({
        method: 'nfc',
        tagUid,
        matchedCheckpoint,
        siteId: getBoundSiteIdSync() || getCachedSiteSettings().id || null,
        guardId: user?.id || null,
        guardName: user?.full_name || 'Unknown guard',
        shiftId: shiftSession?.id || getShiftSession()?.id || null,
        shiftLabel: shiftSession?.shiftLabel || 'On Duty',
        patrolId: session.id || null,
        isOnline: isAppOnline(),
      });

      await persistPatrolScan(entry, post);
      NotificationService.announceCheckpointCaptured(entry.checkpoint_name, {
        shiftId: entry.shift_id,
        checkpointId: entry.checkpoint_id,
        method: 'nfc',
      }).catch(() => null);
    } catch (err) {
      console.warn('[PatrolRecorder] nfc log failed:', err?.message || err);
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [post, user, shiftSession]);

  // Detection runs for the whole patrol. Android only dispatches NFC to a foreground activity, so
  // this covers the guard walking with the app open; a pocketed phone is recorded by GPS instead.
  useEffect(() => {
    if (!patrolActive) return undefined;
    let stop = null;
    let cancelled = false;
    listenForNfcTags((tagUid) => logNfcTag(tagUid)).then((cleanup) => {
      if (cancelled) cleanup();
      else stop = cleanup;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [patrolActive, logNfcTag]);

  // Fold whatever the background service recorded into the session and the offline queue.
  const drainNative = useCallback(async () => {
    if (!isBackgroundPatrolAvailable()) return;
    await drainBackgroundPatrol({
      post,
      context: {
        siteId: getBoundSiteIdSync() || getCachedSiteSettings().id || null,
        guardId: user?.id || null,
        guardName: user?.full_name || 'Unknown guard',
        shiftId: shiftSession?.id || getShiftSession()?.id || null,
        shiftLabel: shiftSession?.shiftLabel || 'On Duty',
        patrolId: getActivePatrolSession()?.id || null,
        isOnline: isAppOnline(),
      },
    });
  }, [post, user, shiftSession]);

  // Hand the patrol to the native service for the duration of the walk. It keeps recording with the
  // screen off, which the WebView cannot do — see src/lib/backgroundPatrol.js.
  useEffect(() => {
    if (!patrolActive) {
      stopBackgroundPatrol();
      return undefined;
    }

    let cancelled = false;
    startBackgroundPatrol(getActivePatrolSession()?.id).then((started) => {
      if (!cancelled) setNativeStarted(started);
    });

    return () => {
      cancelled = true;
    };
  }, [patrolActive]);

  // Drain while the app is alive so the live map and progress keep up, and the moment it comes back
  // to the foreground so a walk done with the screen off lands as soon as the guard looks at it.
  useEffect(() => {
    if (!patrolActive || !nativeTracking) return undefined;

    drainNative();
    const timer = setInterval(drainNative, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') drainNative();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [patrolActive, nativeTracking, drainNative]);

  // Held in a ref so the long-lived watch callback always sees current props without being torn
  // down and restarted (which would drop the GPS fix stream mid-patrol).
  const handleFixRef = useRef(() => {});
  handleFixRef.current = (fix) => {
    const session = getActivePatrolSession();
    if (!session) return;

    appendRoutePoint(fix);

    const previousFix = previousFixRef.current;
    previousFixRef.current = fix;

    const newlyReached = evaluateGpsProgress(
      getPatrolConfig().checkpoints,
      previousFix,
      fix,
      session.reachedCheckpointIds || [],
    );
    newlyReached.forEach((checkpoint) => logCheckpoint(checkpoint, fix));
  };

  useEffect(() => {
    if (!patrolActive || !geo.isSupported) return undefined;
    // Exactly one recorder at a time. Running this watch alongside the native service logged every
    // checkpoint twice; while the service has not answered yet, neither runs, which costs a moment
    // of route at the very start and never costs a duplicated check-in.
    if (!useInAppWatch) return undefined;
    previousFixRef.current = null;
    geo.startWatch((fix) => handleFixRef.current(fix));
    return () => geo.stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patrolActive, geo.isSupported, useInAppWatch]);

  // Hold the screen awake for the duration of the patrol. Android all but stops GPS once the
  // display sleeps, so this is what keeps the route continuous on a phone that is in hand.
  useEffect(() => {
    if (!patrolActive) return undefined;
    // Only needed when the WebView is the recorder. With the native service running, the screen is
    // free to sleep — which is the whole point of it, and saves the battery a whole shift.
    if (!useInAppWatch) return undefined;
    requestScreenWakeLock();
    return () => { releaseScreenWakeLock(); };
  }, [patrolActive, useInAppWatch]);

  return null;
}
