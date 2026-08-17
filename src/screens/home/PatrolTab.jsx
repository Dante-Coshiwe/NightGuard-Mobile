import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useOfflineApi } from '../../hooks/useOfflineApi';
import { getCachedSiteSettings, getPatrolConfig, getShiftSession } from '../../lib/deviceStore';
import { getBoundSiteIdSync } from '../../lib/siteResolver';
import NotificationService from '../../services/notificationService';
import {
  buildPatrolCompletionPayload,
  endPatrolSession,
  getActivePatrolSession,
  PATROL_SESSION_EVENT,
  resolvePendingPatrolCompletion,
  startPatrolSession,
} from '../../lib/patrolSession';
import {
  backgroundPatrolStatus,
  drainBackgroundPatrol,
  isBackgroundPatrolAvailable,
  stopBackgroundPatrol,
} from '../../lib/backgroundPatrol';
import { distanceMeters, hasCoordinates, nextCheckpointGuidance } from '../../lib/geo';
import { clearPatrolDue, getPatrolDue, subscribePatrolDue } from '../../lib/patrolDueAlarm';
import CheckpointMap from '../../components/CheckpointMap';
import './home-styles.css';

// The patrol screen a guard uses on a dark site, often in a hurry.
//
// It deliberately shows ONE number, a ticked list, and ONE button. Everything a guard cannot act on
// mid-walk — distance, step estimates, route point counts, the live map, recent scan history, the
// site's schedule settings — was removed: it filled the screen with figures that changed nothing
// about what to do next, and buried End Patrol below the fold.
//
// There are no check-in buttons at all any more. Points are gathered automatically: GPS by
// <PatrolRecorder />, NFC tags by simply holding the phone to them. The old "Check In (GPS)",
// "Scan NFC Point" and manual tag-entry controls are gone — manual tag entry in particular let a
// guard type a checkpoint they never walked to.

export default function PatrolTab() {
  const { user, shiftSession } = useAuth();
  const { post, isOnline } = useOfflineApi();
  const [feedback, setFeedback] = useState('');
  // The patrol is a persisted session (survives leaving this screen / app restarts), so an
  // unfinished patrol is RESUMED, never silently lost.
  const [session, setSession] = useState(getActivePatrolSession());
  const [endedSummary, setEndedSummary] = useState(null);
  const [patrolConfig, setPatrolConfig] = useState(getPatrolConfig());
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  // A scheduled patrol that has come due and is currently sounding the alarm. The button flashes
  // and the noise continues until it is pressed — there is no other way to silence it.
  const [patrolDue, setPatrolDue] = useState(getPatrolDue());
  const endingRef = useRef(false);

  useEffect(() => subscribePatrolDue(() => setPatrolDue(getPatrolDue())), []);

  const patrolActive = Boolean(session);

  useEffect(() => {
    const refresh = () => setPatrolConfig(getPatrolConfig());
    // The background recorder owns the GPS watch, so progress can advance while this screen is
    // closed. Re-read the session whenever it changes on disk instead of trusting local state.
    const refreshSession = () => setSession(getActivePatrolSession());

    refresh();
    window.addEventListener('nightguard_patrol_config_updated', refresh);
    window.addEventListener('nightguard_sync_complete', refresh);
    window.addEventListener(PATROL_SESSION_EVENT, refreshSession);
    return () => {
      window.removeEventListener('nightguard_patrol_config_updated', refresh);
      window.removeEventListener('nightguard_sync_complete', refresh);
      window.removeEventListener(PATROL_SESSION_EVENT, refreshSession);
    };
  }, []);

  // Whether the native service is genuinely recording. Having the plugin is not enough — it also
  // refuses without location permission, and a guard told to pocket the phone on the strength of a
  // plugin that then recorded nothing walks the whole route for nothing.
  useEffect(() => {
    if (!patrolActive || !isBackgroundPatrolAvailable()) {
      setBackgroundRunning(false);
      return undefined;
    }
    let cancelled = false;
    const sync = async () => {
      const status = await backgroundPatrolStatus();
      if (!cancelled) setBackgroundRunning(status?.running === true);
    };
    sync();
    const timer = setInterval(sync, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [patrolActive]);

  const scanContext = () => ({
    siteId: getBoundSiteIdSync() || getCachedSiteSettings().id || null,
    guardId: user?.id || null,
    guardName: user?.full_name || 'Unknown guard',
    shiftId: shiftSession?.id || getShiftSession()?.id || null,
    shiftLabel: shiftSession?.shiftLabel || 'On Duty',
    patrolId: getActivePatrolSession()?.id || null,
    isOnline,
  });

  // Reached checkpoints come from the persisted session, so progress survives leaving the app.
  const reachedCheckpointIds = new Set((session?.reachedCheckpointIds || []).map(String));
  const requiredCheckpoints = patrolConfig.checkpoints.filter((checkpoint) => checkpoint.required !== false);
  const requiredCheckpointCount = requiredCheckpoints.length;
  const requiredCheckpointIds = new Set(requiredCheckpoints.map((checkpoint) => String(checkpoint.id)));
  // Lock the target to what the site required when this patrol started — a config sync arriving
  // mid-walk must not move the finish line under the guard.
  const patrolTargetCount = (patrolActive && session?.requiredCount)
    || requiredCheckpointCount
    || patrolConfig.minimumTagCount
    || 1;
  const reachedRequiredCount = requiredCheckpointCount
    ? [...reachedCheckpointIds].filter((id) => requiredCheckpointIds.has(id)).length
    : reachedCheckpointIds.size;

  // Where the guard is now, taken from the tail of the recorded route rather than opening a second
  // GPS watch — the recorder already keeps this fresh whether the native service or the in-app
  // watch is doing the work.
  const currentPosition = session?.route?.length ? session.route[session.route.length - 1] : null;
  const nextPoint = nextCheckpointGuidance(
    patrolConfig.checkpoints,
    [...reachedCheckpointIds],
    currentPosition,
  );
  const hasGpsCheckpoints = patrolConfig.checkpoints.some(hasCoordinates);

  const handleStartPatrol = () => {
    // Silences the alarm and tells us whether this start answers a scheduled patrol. Done first so
    // the noise stops the instant the guard's finger lands, not after the network work below.
    const due = clearPatrolDue();
    if (due) {
      // Bookkeeping the old full-screen alert used to own: drop the fired notification, put the
      // next occurrence back, and record the start in the in-app feed.
      NotificationService.cancelNotification(
        due.notificationId || NotificationService.getNotificationIdForPatrolTime(due.time),
      ).catch(() => null);
      NotificationService.rescheduleNextPatrolOccurrence(due.time).catch(() => null);
      NotificationService.addToAppNotificationFeed({
        type: 'patrol_start',
        title: 'Patrol started',
        body: `Scheduled patrol ${due.time} started.`,
        metadata: { shiftId: due.shiftId, patrolTime: due.time },
      }).catch(() => null);
    }

    const context = scanContext();
    const started = startPatrolSession({
      siteId: context.siteId,
      shiftId: context.shiftId,
      guardId: context.guardId,
      guardName: context.guardName,
      requiredCount: patrolTargetCount,
    });
    setSession(started);
    setEndedSummary(null);
    setFeedback('Walk your route. Points are gathered for you.');

    // Register the patrol row server-side immediately (queued when offline) so mid-patrol
    // scans referencing this patrol_id never hit nfc_scans_patrol_id_fkey. /patrols/start is
    // idempotent (DO NOTHING on conflict), and /patrols/complete overwrites with the summary.
    post('/patrols/start', {
      id: started.id,
      site_id: context.siteId,
      shift_id: context.shiftId,
      guard_id: context.guardId,
      patrol_name: started.patrolName,
      actual_start: started.startedAt,
      status: 'in_progress',
    }, {
      clientTempId: started.id,
      offlineResponse: { id: started.id, _offline: true },
    }).catch((err) => {
      // The scan-side stub upsert covers us if this fails; never block the patrol UI on it.
      console.warn('[PatrolTab] /patrols/start registration failed (stub fallback will cover scans):', err?.message || err);
    });
  };

  const handleEndPatrol = async ({ auto = false } = {}) => {
    if (endingRef.current) return;
    endingRef.current = true;
    try {
      const active = getActivePatrolSession();
      if (!active) return;

      const context = scanContext();

      // Stop background recording and fold in everything it captured BEFORE the patrol is measured
      // and closed: endPatrolSession builds the completion payload from the session, and anything
      // still sitting in the native buffer would be left out of the route and the score.
      await stopBackgroundPatrol();
      await drainBackgroundPatrol({ post, context });

      // Re-read progress after the drain — points captured with the screen off count too.
      const latest = getActivePatrolSession() || active;
      const latestReached = new Set((latest.reachedCheckpointIds || []).map(String));
      const reachedCount = requiredCheckpointCount
        ? [...latestReached].filter((id) => requiredCheckpointIds.has(id)).length
        : latestReached.size;
      const completed = reachedCount >= patrolTargetCount;
      const status = completed ? 'completed' : 'incomplete';

      // endPatrolSession writes the completion to a durable outbox before it clears the session,
      // so an app kill anywhere from here on is recovered on the next launch rather than losing
      // the patrol and its route.
      const finished = endPatrolSession(status, context);
      setSession(null);
      setEndedSummary({ status, reachedCount, target: patrolTargetCount });

      // Persist the patrol + walked route to the control room (queued when offline). Same builder
      // the outbox uses, so the live send and a crash-recovered send are byte-identical.
      const result = await post(
        '/patrols/complete',
        buildPatrolCompletionPayload(finished, context),
        { clientTempId: finished.id },
      );

      // Delivered or durably queued — either way the offline queue owns it now.
      resolvePendingPatrolCompletion(finished.id);

      setFeedback(completed
        ? 'Patrol finished. All points gathered.'
        : `Patrol ended with ${reachedCount} of ${patrolTargetCount} points gathered.`);

      await NotificationService.addToAppNotificationFeed({
        type: completed ? 'patrol_complete' : 'patrol_incomplete',
        title: completed ? 'Patrol completed' : 'Patrol incomplete',
        body: auto
          ? `Patrol finished with ${reachedCount}/${patrolTargetCount} points.`
          : `Patrol ended with ${reachedCount}/${patrolTargetCount} points.`,
        metadata: { shiftId: context.shiftId, reachedCount, patrolTargetCount, patrolId: finished.id },
      });

      // Referenced so the offline/queued distinction still reaches the log for support.
      if (result?._offline) console.info('[PatrolTab] completion queued offline');
    } finally {
      endingRef.current = false;
    }
  };

  useEffect(() => {
    if (!patrolActive) return;
    // Never auto-finish against a checkpoint list that has not loaded. On a cold offline start the
    // config can be momentarily empty, which collapses the target to 1 and ended the patrol on the
    // guard's very first point.
    if (!patrolConfig.checkpoints.length) return;
    if (reachedRequiredCount >= patrolTargetCount) {
      handleEndPatrol({ auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachedRequiredCount, patrolActive, patrolTargetCount, patrolConfig.checkpoints.length]);

  return (
    <div className="tab-content">
      <div className="patrol-container">
        {!patrolActive ? (
          <>
            <div style={{ textAlign: 'center', padding: '28px 0 22px' }}>
              {patrolDue ? (
                <>
                  <div style={{ fontSize: 15, color: '#fca5a5', marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>
                    PATROL DUE NOW
                  </div>
                  <div style={{ fontSize: 26, color: '#fff', fontWeight: 800, marginBottom: 6 }}>
                    Scheduled patrol {patrolDue.time}
                  </div>
                  <div style={{ fontSize: 17, color: '#e5e5e5' }}>Press Start Patrol to silence the alarm</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: '#8b8b8b', marginBottom: 6 }}>Ready to patrol</div>
                  <div style={{ fontSize: 17, color: '#e5e5e5' }}>
                    {patrolTargetCount} point{patrolTargetCount === 1 ? '' : 's'} on your route
                  </div>
                </>
              )}
            </div>

            <button
              className={patrolDue ? 'button-add patrol-due-flash' : 'button-add'}
              onClick={handleStartPatrol}
              style={{ fontSize: 20, padding: '22px 0', fontWeight: 700 }}
            >
              Start Patrol
            </button>

            {endedSummary && (
              <div
                style={{
                  textAlign: 'center',
                  marginTop: 18,
                  fontSize: 15,
                  color: endedSummary.status === 'completed' ? '#4ade80' : '#fbbf24',
                }}
              >
                Last patrol: {endedSummary.reachedCount} of {endedSummary.target} points gathered
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', padding: '26px 0 18px' }}>
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: 1.5,
                  color: '#4ade80',
                  marginBottom: 10,
                  fontWeight: 700,
                }}
              >
                PATROL RUNNING
              </div>
              <div style={{ fontSize: 54, fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                {reachedRequiredCount} of {patrolTargetCount}
              </div>
              <div style={{ fontSize: 16, color: '#8b8b8b', marginTop: 6 }}>points gathered</div>
            </div>

            {/* Where to walk next. Advisory only — points count in ANY order, so this is a hint,
                never a sequence the guard has to follow. */}
            {nextPoint && (
              <div
                style={{
                  background: '#0a1520',
                  border: '1px solid #1e4976',
                  borderRadius: 12,
                  padding: '14px 16px',
                  marginBottom: 14,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 13, color: '#7dd3fc', letterSpacing: 0.6, marginBottom: 6 }}>
                  NEXT POINT
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff' }}>
                  {nextPoint.checkpoint.name || 'Next point'}
                </div>
                <div style={{ fontSize: 17, color: '#bae6fd', marginTop: 6 }}>
                  {Math.round(nextPoint.distance)} m {nextPoint.direction}
                </div>
              </div>
            )}

            {hasGpsCheckpoints && (
              <div style={{ marginBottom: 16 }}>
                <CheckpointMap
                  checkpoints={patrolConfig.checkpoints}
                  reachedIds={[...reachedCheckpointIds]}
                  route={session?.route || []}
                  title="Where you are"
                />
              </div>
            )}

            <div className="list-container" style={{ marginBottom: 18 }}>
              {patrolConfig.checkpoints.map((checkpoint) => {
                const reached = reachedCheckpointIds.has(String(checkpoint.id));
                // How far the guard still has to walk to this one, when both ends are known.
                const away = (!reached && currentPosition && hasCoordinates(checkpoint))
                  ? Math.round(distanceMeters(
                    currentPosition.latitude, currentPosition.longitude,
                    Number(checkpoint.latitude), Number(checkpoint.longitude),
                  ))
                  : null;
                return (
                  <div
                    key={checkpoint.id}
                    className="list-item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      borderColor: reached ? '#166534' : undefined,
                      background: reached ? '#0a1a0a' : undefined,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 22,
                        lineHeight: 1,
                        color: reached ? '#22c55e' : '#4b4b4b',
                        width: 24,
                        textAlign: 'center',
                      }}
                    >
                      {reached ? '✓' : '○'}
                    </span>
                    <span
                      style={{
                        fontSize: 17,
                        color: reached ? '#86efac' : '#e5e5e5',
                        fontWeight: 600,
                        flex: 1,
                      }}
                    >
                      {checkpoint.name || 'Unnamed point'}
                    </span>
                    {!reached && away !== null && (
                      <span style={{ fontSize: 15, color: '#8b8b8b' }}>{away} m</span>
                    )}
                  </div>
                );
              })}
            </div>

            {!backgroundRunning && (
              <div
                style={{
                  background: '#1a1400',
                  border: '1px solid #a16207',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 14,
                  color: '#fde68a',
                  fontSize: 14,
                  lineHeight: 1.5,
                  textAlign: 'center',
                }}
              >
                Keep the screen on and the app open until you tap End Patrol.
              </div>
            )}

            <button
              className="button-primary"
              onClick={() => handleEndPatrol()}
              style={{
                background: '#15803d',
                borderColor: '#166534',
                color: '#dcfce7',
                fontSize: 20,
                padding: '22px 0',
                fontWeight: 700,
              }}
            >
              End Patrol
            </button>
          </>
        )}

        {feedback && (
          <div className="patrol-message-card success" style={{ textAlign: 'center', fontSize: 15 }}>
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}
