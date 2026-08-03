import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNFC } from '../../hooks/useNFC';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useOfflineApi } from '../../hooks/useOfflineApi';
import { getCachedSiteSettings, getNfcScans, getPatrolConfig, getShiftSession } from '../../lib/deviceStore';
import NotificationService from '../../services/notificationService';
import { hasCoordinates, MAX_ACCEPTABLE_ACCURACY_METERS } from '../../lib/geo';
import { buildPatrolScanEntry, evaluateGpsFix, matchNfcCheckpoint } from '../../lib/patrolCheckin';
import { persistPatrolScan } from '../../lib/patrolScanStore';
import {
  appendRoutePoint,
  buildPatrolCompletionPayload,
  endPatrolSession,
  formatDistance,
  formatDuration,
  summarisePatrol,
  getActivePatrolSession,
  getLastPatrolSession,
  markCheckpointReached,
  PATROL_SESSION_EVENT,
  resolvePendingPatrolCompletion,
  startPatrolSession,
} from '../../lib/patrolSession';
import {
  drainBackgroundPatrol,
  isBackgroundPatrolAvailable,
  stopBackgroundPatrol,
} from '../../lib/backgroundPatrol';
import CheckpointMap from '../../components/CheckpointMap';
import './home-styles.css';

export default function PatrolTab() {
  const { user, shiftSession } = useAuth();
  const { post, isOnline } = useOfflineApi();
  const { isSupported, scanning, error: nfcError, startScan } = useNFC();
  const geo = useGeolocation();
  const [manualTag, setManualTag] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  // The patrol is a persisted session (survives leaving this screen / app restarts), so an
  // unfinished patrol is RESUMED, never silently lost.
  const [session, setSession] = useState(getActivePatrolSession());
  const [endedSummary, setEndedSummary] = useState(null);
  const [lastPatrol, setLastPatrol] = useState(getLastPatrolSession());
  const [patrolConfig, setPatrolConfig] = useState(getPatrolConfig());
  const [recentScans, setRecentScans] = useState(getNfcScans().slice(0, 6));
  const endingRef = useRef(false);

  const patrolActive = Boolean(session);
  const patrolStartedAt = session ? new Date(session.startedAt).getTime() : null;
  // Whether THIS install can record with the screen off. The same web bundle also runs on shells
  // built before the tracking service existed, and a guard must be told the truth for the phone in
  // their hand rather than a promise the device cannot keep.
  const backgroundTrackingAvailable = isBackgroundPatrolAvailable();

  useEffect(() => {
    const refresh = () => {
      setPatrolConfig(getPatrolConfig());
      setRecentScans(getNfcScans().slice(0, 6));
    };
    const refreshHistory = () => setLastPatrol(getLastPatrolSession());

    // The background recorder owns the GPS watch, so progress can advance while this screen is
    // closed. Re-read the session whenever it changes on disk instead of trusting local state.
    const refreshSession = () => setSession(getActivePatrolSession());

    refresh();
    if (getActivePatrolSession()) {
      setFeedback(`Resumed unfinished patrol started at ${new Date(getActivePatrolSession().startedAt).toLocaleTimeString()}.`);
    }
    window.addEventListener('nightguard_patrol_config_updated', refresh);
    window.addEventListener('nightguard_sync_complete', refresh);
    window.addEventListener('nightguard_patrol_history_updated', refreshHistory);
    window.addEventListener(PATROL_SESSION_EVENT, refreshSession);
    return () => {
      window.removeEventListener('nightguard_patrol_config_updated', refresh);
      window.removeEventListener('nightguard_sync_complete', refresh);
      window.removeEventListener('nightguard_patrol_history_updated', refreshHistory);
      window.removeEventListener(PATROL_SESSION_EVENT, refreshSession);
    };
  }, []);

  const scanContext = () => ({
    siteId: getCachedSiteSettings().id || null,
    guardId: user?.id || null,
    guardName: user?.full_name || 'Unknown guard',
    shiftId: shiftSession?.id || getShiftSession()?.id || null,
    shiftLabel: shiftSession?.shiftLabel || 'On Duty',
    patrolId: getActivePatrolSession()?.id || null,
    isOnline,
  });

  const submitScan = async (entry) => {
    setSubmitting(true);
    setFeedback('');
    try {
      await persistPatrolScan(entry, post);
      setRecentScans(getNfcScans().slice(0, 6));
      if (entry.checkpoint_id) {
        setSession(markCheckpointReached(entry.checkpoint_id) || getActivePatrolSession());
        // Audible/visible ping the moment a point is captured.
        NotificationService.announceCheckpointCaptured(entry.checkpoint_name, {
          shiftId: entry.shift_id,
          checkpointId: entry.checkpoint_id,
          method: entry.method,
        }).catch(() => null);
      }
      if (entry.status === 'unregistered' && patrolActive) {
        await NotificationService.addToAppNotificationFeed({
          type: 'scan_missed',
          title: 'Unregistered checkpoint',
          body: `An unregistered ${entry.method === 'gps' ? 'location' : 'tag'} was logged during patrol.`,
          metadata: { shiftId: entry.shift_id, tagUid: entry.tag_uid },
        });
      }
      setFeedback(entry.checkpoint_id
        ? `${entry.checkpoint_name} patrol point has been gathered`
        : `${entry.checkpoint_name} logged`);
      setManualTag('');
      return true;
    } catch (err) {
      setFeedback(err.message || 'Scan saved on device and will sync later');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const registerNfcScan = async (tagUid) => {
    const matchedCheckpoint = matchNfcCheckpoint(patrolConfig.checkpoints, tagUid);
    const entry = buildPatrolScanEntry({ method: 'nfc', tagUid, matchedCheckpoint, ...scanContext() });
    await submitScan(entry);
  };

  const registerGpsCheckin = async (position, matchedCheckpoint) => {
    const entry = buildPatrolScanEntry({ method: 'gps', position, matchedCheckpoint, ...scanContext() });
    return submitScan(entry);
  };

  // The GPS watch lives in <PatrolRecorder />, mounted at the app shell, so route points and
  // automatic check-ins keep being captured while the guard is on any other screen. This tab only
  // reflects the session it maintains, plus the manual actions below.
  const hasGpsCheckpoints = patrolConfig.checkpoints.some(hasCoordinates);

  const handleManualGpsCheckin = async () => {
    setCheckingIn(true);
    setFeedback('Reading GPS location...');
    try {
      const fix = await geo.getCurrentPosition();
      appendRoutePoint(fix);
      const result = evaluateGpsFix(patrolConfig.checkpoints, fix);
      if (!result.hasGpsCheckpoints) {
        setFeedback('No GPS checkpoints are configured for this site.');
        return;
      }
      if (result.matchedCheckpoint) {
        await registerGpsCheckin(fix, result.matchedCheckpoint);
        return;
      }
      const accuracy = Number(fix.accuracy);
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
        setFeedback(`Waiting for a better GPS signal (±${Math.round(accuracy)} m). Move to open sky and try again.`);
        return;
      }
      const distance = Math.round(result.distance);
      setFeedback(`You are about ${distance} m from ${result.nearestCheckpoint?.name || 'the nearest checkpoint'}. Move closer (within 5 m) and try again.`);
    } catch (err) {
      setFeedback(err.message || 'Unable to read GPS location.');
    } finally {
      setCheckingIn(false);
    }
  };

  const handleStartPatrol = () => {
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
    setFeedback('Patrol is active. Walk your route — GPS points log automatically, NFC tags are optional.');

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
      setEndedSummary(finished);
      setLastPatrol(finished);

      const summaryText = completed
        ? `Patrol completed. All ${patrolTargetCount} required points were reached.`
        : `Patrol ended early — ${reachedCount}/${patrolTargetCount} required points reached. Saved as incomplete.`;

      // Persist the patrol + walked route to the control room (queued when offline). Same builder
      // the outbox uses, so the live send and a crash-recovered send are byte-identical.
      const result = await post(
        '/patrols/complete',
        buildPatrolCompletionPayload(finished, context),
        { clientTempId: finished.id },
      );

      // Delivered or durably queued — either way the offline queue owns it now.
      resolvePendingPatrolCompletion(finished.id);

      setFeedback(result?._offline
        ? `${summaryText} Stored on this device — it will sync to the dashboard when back online.`
        : `${summaryText} Synced to the dashboard.`);

      await NotificationService.addToAppNotificationFeed({
        type: completed ? 'patrol_complete' : 'patrol_incomplete',
        title: completed ? 'Patrol completed' : 'Patrol incomplete',
        body: auto ? summaryText : `${summaryText}${completed ? '' : ' You can start a new patrol to finish the remaining points.'}`,
        metadata: { shiftId: context.shiftId, reachedCount, patrolTargetCount, patrolId: finished.id },
      });
    } finally {
      endingRef.current = false;
    }
  };

  const handleNfcScan = async () => {
    await startScan((tagUid) => {
      registerNfcScan(tagUid);
    });
  };

  const scansThisPatrol = patrolStartedAt
    ? getNfcScans().filter((scan) => new Date(scan.scanned_at).getTime() >= patrolStartedAt)
    : [];
  const completedThisPatrol = scansThisPatrol.length;
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
  const pendingRequiredCount = Math.max(patrolTargetCount - reachedRequiredCount, 0);

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

  const hasNfcCheckpoints = patrolConfig.checkpoints.some((cp) => cp.tag_uid?.trim());
  const liveSummary = summarisePatrol(session);
  const endedStats = summarisePatrol(endedSummary);

  return (
    <div className="tab-content">
      <div className="patrol-container">
        <div className="summary-card">
          <div className="summary-row">
            <span className="summary-label">Patrol schedule</span>
            <span className="summary-value">{patrolConfig.patrolScheduleEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Required points</span>
            <span className="summary-value">{patrolTargetCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Completed this patrol</span>
            <span className="summary-value">{completedThisPatrol}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Check-in methods</span>
            <span className="summary-value">
              {geo.isSupported && hasGpsCheckpoints ? 'GPS' : ''}
              {geo.isSupported && hasGpsCheckpoints && isSupported && hasNfcCheckpoints ? ' + NFC (optional)' : ''}
              {!(geo.isSupported && hasGpsCheckpoints) && isSupported && hasNfcCheckpoints ? 'NFC' : ''}
              {!(geo.isSupported && hasGpsCheckpoints) && !(isSupported && hasNfcCheckpoints) ? 'Manual' : ''}
            </span>
          </div>
        </div>

        {!patrolActive ? (
          <button className="button-add" onClick={handleStartPatrol}>
            {endedSummary ? 'Start New Patrol' : 'Start Patrol'}
          </button>
        ) : (
          <>
            <div className="summary-card">
              <div className="summary-row">
                <span className="summary-label">Patrol started</span>
                <span className="summary-value">{new Date(patrolStartedAt).toLocaleTimeString()}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Guard</span>
                <span className="summary-value">{user?.full_name || 'Unknown guard'}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Required points reached</span>
                <span className="summary-value">{reachedRequiredCount}/{patrolTargetCount}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Distance walked</span>
                <span className="summary-value">{formatDistance(liveSummary?.distanceMeters)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Est. steps</span>
                <span className="summary-value">{liveSummary?.estimatedSteps || 0}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Route points recorded</span>
                <span className="summary-value">{session?.route?.length || 0}</span>
              </div>
            </div>

            {backgroundTrackingAvailable ? (
              <div
                style={{
                  background: '#04180d',
                  border: '1px solid #166534',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 12,
                  color: '#bbf7d0',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ display: 'block', marginBottom: 4, color: '#4ade80' }}>
                  Recording in the background
                </strong>
                You can lock the screen and pocket the phone — your route and checkpoints keep
                recording, and you will be notified at each point. Come back and tap End Patrol
                when you are finished.
              </div>
            ) : (
              <div
                style={{
                  background: '#1a1400',
                  border: '1px solid #a16207',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 12,
                  color: '#fde68a',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ display: 'block', marginBottom: 4, color: '#fbbf24' }}>
                  Keep your screen on during the patrol
                </strong>
                Your route and checkpoints are recorded from GPS. If the screen switches off or the
                phone goes in your pocket, Android stops the GPS and points will be missed. Keep the
                display awake and the app open until you tap End Patrol.
              </div>
            )}

            {geo.isSupported && hasGpsCheckpoints && (
              <button
                className="button-add"
                onClick={handleManualGpsCheckin}
                disabled={checkingIn || submitting || !patrolConfig.patrolScheduleEnabled}
                style={{ background: '#166534', borderColor: '#22c55e' }}
              >
                {checkingIn ? 'Checking location...' : 'Check In (GPS)'}
              </button>
            )}

            {isSupported && hasNfcCheckpoints && (
              <button className="button-add" onClick={handleNfcScan} disabled={scanning || submitting || !patrolConfig.patrolScheduleEnabled}>
                {scanning ? 'Waiting for NFC tag...' : 'Scan NFC Point (optional)'}
              </button>
            )}

            {hasNfcCheckpoints && (
              <div className="summary-card">
                <div className="form-group">
                  <label className="form-label">Manual NFC tag entry (optional)</label>
                  <input
                    className="form-input"
                    value={manualTag}
                    onChange={(e) => setManualTag(e.target.value)}
                    placeholder="Enter NFC tag code"
                  />
                </div>
                <button className="button-primary" onClick={() => registerNfcScan(manualTag)} disabled={!manualTag || submitting}>
                  Log Manual Scan
                </button>
              </div>
            )}

            <button
              className="button-primary"
              onClick={() => handleEndPatrol()}
              style={{
                background: '#15803d',
                borderColor: '#166534',
                color: '#dcfce7',
              }}
            >
              End Patrol
            </button>
            <div style={{ fontSize: 12, color: '#8b8b8b', textAlign: 'center', marginTop: 6 }}>
              Leaving this screen keeps the patrol running — you can come back and resume it.
            </div>
          </>
        )}

        {endedSummary && !patrolActive && (
          <div className="summary-card" style={{ borderColor: endedSummary.status === 'completed' ? '#166534' : '#92400e' }}>
            <div className="summary-row">
              <span className="summary-label">Last result</span>
              <span className="summary-value" style={{ color: endedSummary.status === 'completed' ? '#22c55e' : '#fbbf24' }}>
                {endedSummary.status === 'completed' ? 'Completed' : 'Incomplete'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Points reached</span>
              <span className="summary-value">{endedSummary.reachedCheckpointIds.length}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Distance walked</span>
              <span className="summary-value">{formatDistance(endedStats?.distanceMeters)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Time on patrol</span>
              <span className="summary-value">{formatDuration(endedStats?.durationMs)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Est. steps</span>
              <span className="summary-value">{endedStats?.estimatedSteps || 0}</span>
            </div>
          </div>
        )}

        {(feedback || nfcError || geo.error) && (
          <div className={`patrol-message-card ${nfcError || geo.error ? 'error' : 'success'}`}>
            {nfcError || geo.error || feedback}
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <h3 className="section-heading">Checkpoints</h3>
            {patrolActive && (
              <span style={{ fontSize: 12, color: pendingRequiredCount > 0 ? '#fbbf24' : '#86efac' }}>
                {pendingRequiredCount > 0 ? `${pendingRequiredCount} left` : 'All points reached'}
              </span>
            )}
          </div>

          {(hasGpsCheckpoints || (session?.route?.length || 0) > 1) && (
            <div style={{ marginBottom: 12 }}>
              <CheckpointMap
                checkpoints={patrolConfig.checkpoints}
                reachedIds={[...reachedCheckpointIds]}
                route={patrolActive ? session?.route || [] : []}
                title={patrolActive ? 'Live patrol map' : 'Checkpoint layout'}
              />
            </div>
          )}

          <div className="list-container">
            {patrolConfig.checkpoints.map((checkpoint) => {
              const reached = reachedCheckpointIds.has(String(checkpoint.id));
              return (
                <div
                  key={checkpoint.id}
                  className="list-item"
                  style={reached ? { borderColor: '#166534', background: '#0a1a0a' } : undefined}
                >
                  <div className="list-item-header">
                    <div className="list-item-title">{checkpoint.name || 'Unnamed point'}</div>
                    {patrolActive
                      ? <div className="list-item-badge" style={{ color: reached ? '#22c55e' : '#8b8b8b' }}>{reached ? 'Reached' : 'Pending'}</div>
                      : <div className="list-item-badge">{checkpoint.zone}</div>}
                  </div>
                  <div className="list-item-meta">
                    {checkpoint.zone ? `${checkpoint.zone} · ` : ''}
                    {hasCoordinates(checkpoint) ? `GPS: ${Number(checkpoint.latitude).toFixed(5)}, ${Number(checkpoint.longitude).toFixed(5)}` : ''}
                    {hasCoordinates(checkpoint) && checkpoint.tag_uid ? ' · ' : ''}
                    {checkpoint.tag_uid ? `NFC tag (optional): ${checkpoint.tag_uid}` : ''}
                    {!checkpoint.tag_uid && !hasCoordinates(checkpoint) ? 'No GPS pin or tag set' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {lastPatrol && (lastPatrol.route?.length || 0) > 1 && (
          <div>
            <h3 className="section-heading">Last patrol route</h3>
            <div style={{ marginBottom: 8 }}>
              <CheckpointMap
                checkpoints={patrolConfig.checkpoints}
                reachedIds={(lastPatrol.reachedCheckpointIds || []).map(String)}
                route={lastPatrol.route}
                title="Last patrol route"
              />
            </div>
            <div style={{ fontSize: 12, color: '#8b8b8b' }}>
              {new Date(lastPatrol.startedAt).toLocaleString()} — {lastPatrol.status === 'completed' ? 'completed' : 'incomplete'} ·{' '}
              {lastPatrol.reachedCheckpointIds.length} point{lastPatrol.reachedCheckpointIds.length === 1 ? '' : 's'} reached ·{' '}
              {lastPatrol.route.length} route points
            </div>
          </div>
        )}

        <div>
          <h3 className="section-heading">Recent patrol scans</h3>
          {recentScans.length === 0 ? (
            <div className="list-empty">
              <p>No scans recorded yet</p>
            </div>
          ) : (
            <div className="list-container">
              {recentScans.map((scan) => (
                <div key={scan.id} className="list-item">
                  <div className="list-item-header">
                    <div className="list-item-title">{scan.checkpoint_name}</div>
                    <div className="list-item-badge">{scan.offline ? 'Queued' : 'Saved'}</div>
                  </div>
                  <div className="list-item-meta">{scan.guard_name}</div>
                  <div className="list-item-meta">{new Date(scan.scanned_at).toLocaleString()}</div>
                  <div className="list-item-meta">{scan.method === 'gps' ? 'GPS check-in' : `Tag: ${scan.tag_uid}`}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
