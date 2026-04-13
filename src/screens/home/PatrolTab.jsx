import React, { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNFC } from '../../hooks/useNFC';
import { useOfflineApi } from '../../hooks/useOfflineApi';
import { appendNfcScan, getNfcScans, getPatrolConfig } from '../../lib/deviceStore';
import './home-styles.css';

export default function PatrolTab() {
  const { user, shiftSession } = useAuth();
  const { post, isOnline } = useOfflineApi();
  const { isSupported, scanning, error: nfcError, startScan } = useNFC();
  const [manualTag, setManualTag] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [patrolStartedAt, setPatrolStartedAt] = useState(null);

  const patrolConfig = useMemo(() => getPatrolConfig(), []);
  const recentScans = useMemo(() => getNfcScans().slice(0, 6), [feedback, patrolStartedAt]);

  const registerScan = async (tagUid) => {
    const matchedCheckpoint = patrolConfig.checkpoints.find(
      (checkpoint) => checkpoint.tag_uid?.toLowerCase() === String(tagUid).toLowerCase()
    );

    const entry = {
      id: `scan_${Date.now()}`,
      guard_id: user?.id || null,
      guard_name: user?.full_name || 'Unknown guard',
      shift_label: shiftSession?.shiftLabel || 'Active Shift',
      scanned_at: new Date().toISOString(),
      tag_uid: tagUid,
      checkpoint_name: matchedCheckpoint?.name || 'Unregistered tag',
      zone: matchedCheckpoint?.zone || 'Unknown zone',
      status: matchedCheckpoint ? 'matched' : 'unregistered',
      offline: !isOnline,
    };

    setSubmitting(true);
    setFeedback('');

    try {
      appendNfcScan(entry);
      await post('/nfc/scan', entry);
      setFeedback(`${entry.checkpoint_name} logged successfully`);
      setManualTag('');
    } catch (err) {
      setFeedback(err.message || 'Scan saved on device and will sync later');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartPatrol = () => {
    setPatrolStartedAt(Date.now());
    setFeedback('Patrol is active. Scan a checkpoint or enter the NFC tag manually.');
  };

  const handleNfcScan = async () => {
    await startScan((tagUid) => {
      registerScan(tagUid);
    });
  };

  const completedThisPatrol = patrolStartedAt
    ? getNfcScans().filter((scan) => new Date(scan.scanned_at).getTime() >= patrolStartedAt).length
    : 0;

  return (
    <div className="tab-content">
      <div className="patrol-container">
        <div className="summary-card">
          <div className="summary-row">
            <span className="summary-label">Patrol schedule</span>
            <span className="summary-value">{patrolConfig.patrolScheduleEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Required NFC points</span>
            <span className="summary-value">{patrolConfig.minimumTagCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Completed this patrol</span>
            <span className="summary-value">{completedThisPatrol}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">NFC support</span>
            <span className="summary-value">{isSupported ? 'Ready on Android Chrome' : 'Manual fallback only'}</span>
          </div>
        </div>

        {!patrolStartedAt ? (
          <button className="button-add" onClick={handleStartPatrol}>
            Start Patrol
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
            </div>

            <button className="button-add" onClick={handleNfcScan} disabled={scanning || submitting || !patrolConfig.patrolScheduleEnabled}>
              {scanning ? 'Waiting for NFC tag...' : 'Scan NFC Point'}
            </button>

            <div className="summary-card">
              <div className="form-group">
                <label className="form-label">Manual NFC tag entry</label>
                <input
                  className="form-input"
                  value={manualTag}
                  onChange={(e) => setManualTag(e.target.value)}
                  placeholder="Enter NFC tag code"
                />
              </div>
              <button className="button-primary" onClick={() => registerScan(manualTag)} disabled={!manualTag || submitting}>
                Log Manual Scan
              </button>
            </div>
          </>
        )}

        {(feedback || nfcError) && (
          <div className={`patrol-message-card ${nfcError ? 'error' : 'success'}`}>
            {nfcError || feedback}
          </div>
        )}

        <div>
          <h3 className="section-heading">Checkpoint tags</h3>
          <div className="list-container">
            {patrolConfig.checkpoints.map((checkpoint) => (
              <div key={checkpoint.id} className="list-item">
                <div className="list-item-header">
                  <div className="list-item-title">{checkpoint.name}</div>
                  <div className="list-item-badge">{checkpoint.zone}</div>
                </div>
                <div className="list-item-meta">Tag UID: {checkpoint.tag_uid}</div>
              </div>
            ))}
          </div>
        </div>

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
                  <div className="list-item-meta">Tag: {scan.tag_uid}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
