import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNFC } from '../hooks/useNFC';
import { useGeolocation } from '../hooks/useGeolocation';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { useAuth } from '../contexts/AuthContext';
import { appendNfcScan, getCachedSiteSettings, getNfcScans, getShiftSession, saveNfcScans } from '../lib/deviceStore';
import { getNFCCheckpoints } from '../services/api';
import { hasCoordinates, MAX_ACCEPTABLE_ACCURACY_METERS } from '../lib/geo';
import { buildPatrolScanEntry, evaluateGpsFix, matchNfcCheckpoint } from '../lib/patrolCheckin';
import { appendRoutePoint, markCheckpointReached } from '../lib/patrolSession';
import NotificationService from '../services/notificationService';
import CheckpointMap from '../components/CheckpointMap';
import './screens.css';

export default function PatrolTrackingScreen() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const patrol = state?.patrol;
  const { user, shiftSession } = useAuth();
  const { post } = useOfflineApi();

  const [checkpoints, setCheckpoints] = useState([]);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const loggedGpsCheckpointsRef = useRef(new Set());

  const { isSupported, scanning, error: nfcError, startScan, stopScan } = useNFC();
  const geo = useGeolocation();

  useEffect(() => {
    loadCheckpoints();
    setScans(getNfcScans());
    return () => stopScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCheckpoints = async () => {
    setLoading(true);
    try {
      const data = await getNFCCheckpoints();
      setCheckpoints(data);
    } catch (err) {
      console.error('Failed to load checkpoints:', err);
    } finally {
      setLoading(false);
    }
  };

  const scanContext = () => ({
    siteId: getCachedSiteSettings().id || null,
    guardId: user?.id || null,
    guardName: user?.full_name || 'Unknown guard',
    shiftId: shiftSession?.id || getShiftSession()?.id || null,
    shiftLabel: shiftSession?.shiftLabel || 'On Duty',
    patrolId: patrol?.id || null,
    isOnline: navigator.onLine,
  });

  const submitScan = async (entry) => {
    try {
      appendNfcScan(entry);
      setScans((prev) => [entry, ...prev]);

      const result = await post('/nfc/scan', entry, {
        clientTempId: entry.id,
        offlineResponse: { ...entry, _offline: true },
      });

      if (!result?._offline) {
        const updated = getNfcScans().map((scan) => (
          String(scan.id) === String(entry.id) ? { ...scan, offline: false, _offline: false } : scan
        ));
        saveNfcScans(updated);
        setScans(updated);
      }
      if (entry.checkpoint_id) {
        loggedGpsCheckpointsRef.current.add(entry.checkpoint_id);
        markCheckpointReached(entry.checkpoint_id);
        NotificationService.announceCheckpointCaptured(entry.checkpoint_name, {
          checkpointId: entry.checkpoint_id,
          method: entry.method,
        }).catch(() => null);
      }
      setScanFeedback({ success: true, message: `${result.checkpoint_name || entry.checkpoint_name || 'Checkpoint'} patrol point has been gathered` });
      setTimeout(() => setScanFeedback(null), 3000);
    } catch (err) {
      setScanFeedback({ success: false, message: err.response?.data?.error || 'Scan saved locally and will sync later' });
      setTimeout(() => setScanFeedback(null), 3000);
    }
  };

  const handleNFCScan = async (tagUid) => {
    const matchedCheckpoint = matchNfcCheckpoint(checkpoints, tagUid);
    const entry = buildPatrolScanEntry({ method: 'nfc', tagUid, matchedCheckpoint, ...scanContext() });
    await submitScan(entry);
  };

  const handleStartScanning = () => {
    startScan(handleNFCScan);
  };

  // Auto GPS check-in while on the tracking screen.
  const gpsFixHandlerRef = useRef(() => {});
  gpsFixHandlerRef.current = (fix) => {
    // Feed the walked-route breadcrumb trail of the active patrol session (if one is running).
    appendRoutePoint(fix);
    const result = evaluateGpsFix(checkpoints, fix);
    if (result.matchedCheckpoint && !loggedGpsCheckpointsRef.current.has(result.matchedCheckpoint.id)) {
      loggedGpsCheckpointsRef.current.add(result.matchedCheckpoint.id);
      const entry = buildPatrolScanEntry({ method: 'gps', position: fix, matchedCheckpoint: result.matchedCheckpoint, ...scanContext() });
      submitScan(entry);
    }
  };

  const hasGpsCheckpoints = checkpoints.some(hasCoordinates);

  useEffect(() => {
    if (!geo.isSupported || !hasGpsCheckpoints) return undefined;
    geo.startWatch((fix) => gpsFixHandlerRef.current(fix));
    return () => geo.stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGpsCheckpoints, geo.isSupported]);

  const handleManualGpsCheckin = async () => {
    setCheckingIn(true);
    try {
      const fix = await geo.getCurrentPosition();
      const result = evaluateGpsFix(checkpoints, fix);
      if (result.matchedCheckpoint) {
        const entry = buildPatrolScanEntry({ method: 'gps', position: fix, matchedCheckpoint: result.matchedCheckpoint, ...scanContext() });
        await submitScan(entry);
      } else if (!result.hasGpsCheckpoints) {
        setScanFeedback({ success: false, message: 'No GPS checkpoints configured for this site' });
        setTimeout(() => setScanFeedback(null), 3000);
      } else if (Number.isFinite(Number(fix.accuracy)) && Number(fix.accuracy) > MAX_ACCEPTABLE_ACCURACY_METERS) {
        setScanFeedback({ success: false, message: `Waiting for a better GPS signal (±${Math.round(fix.accuracy)} m)` });
        setTimeout(() => setScanFeedback(null), 3500);
      } else {
        setScanFeedback({ success: false, message: `About ${Math.round(result.distance)} m away — move closer` });
        setTimeout(() => setScanFeedback(null), 3500);
      }
    } catch (err) {
      setScanFeedback({ success: false, message: err.message || 'Unable to read GPS' });
      setTimeout(() => setScanFeedback(null), 3000);
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="screen-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 14, cursor: 'pointer' }}>
          ← Back
        </button>
        <h1 className="patrols-title" style={{ margin: 0 }}>
          {patrol?.patrol_name || 'Patrol'}
        </h1>
      </div>

      <div style={{ background: '#0a0a0a', border: `1px solid ${scanning ? '#22c55e' : '#1f1f1f'}`, borderRadius: 12, padding: 20, marginBottom: 20, textAlign: 'center' }}>
        {isSupported ? (
          scanning ? (
            <div>
              <div style={{ color: '#22c55e', fontSize: 16, fontWeight: 600 }}>Ready to scan</div>
              <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>Hold phone near NFC tag</div>
              <button onClick={stopScan}
                style={{ marginTop: 12, padding: '8px 20px', background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                Stop Scanning
              </button>
            </div>
          ) : (
            <div>
              <div style={{ color: '#fff', fontSize: 14, marginBottom: 12 }}>NFC scanning is optional — GPS check-in works on its own</div>
              <button onClick={handleStartScanning}
                style={{ padding: '10px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Scan NFC Tag (optional)
              </button>
            </div>
          )
        ) : (
          <div>
            <div style={{ color: '#fff', fontSize: 14 }}>NFC not available — use GPS check-in</div>
          </div>
        )}
        {nfcError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{nfcError}</div>}
      </div>

      {geo.isSupported && hasGpsCheckpoints && (
        <div style={{ background: '#0a0a0a', border: '1px solid #166534', borderRadius: 12, padding: 20, marginBottom: 20, textAlign: 'center' }}>
          <div style={{ color: '#86efac', fontSize: 14, marginBottom: 4 }}>GPS check-in active</div>
          <div style={{ color: '#555', fontSize: 12, marginBottom: 12 }}>You'll be logged automatically at each checkpoint, or tap below.</div>
          <button onClick={handleManualGpsCheckin} disabled={checkingIn}
            style={{ padding: '10px 24px', background: '#166534', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: checkingIn ? 0.6 : 1 }}>
            {checkingIn ? 'Checking location...' : 'Check In (GPS)'}
          </button>
          {geo.error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{geo.error}</div>}
        </div>
      )}

      {scanFeedback && (
        <div style={{
          position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
          background: scanFeedback.success ? '#166534' : '#7f1d1d',
          color: scanFeedback.success ? '#86efac' : '#fca5a5',
          padding: '12px 24px', borderRadius: 12, fontSize: 15, fontWeight: 600,
          zIndex: 1000, boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}>
          {scanFeedback.message}
        </div>
      )}

      {checkpoints.some(hasCoordinates) && (
        <div style={{ marginBottom: 20 }}>
          <CheckpointMap
            checkpoints={checkpoints}
            reachedIds={checkpoints.filter((cp) => scans.some((scan) => scan.checkpoint_id === cp.id || (cp.tag_uid && scan.tag_uid === cp.tag_uid))).map((cp) => cp.id)}
          />
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: '#fff', marginBottom: 12 }}>
          Checkpoints ({checkpoints.length})
        </h2>
        {loading ? (
          <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>Loading...</div>
        ) : checkpoints.length === 0 ? (
          <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>No checkpoints registered for this site</div>
        ) : (
          checkpoints.map((cp) => {
            const scanned = scans.some((scan) => scan.checkpoint_id === cp.id || (cp.tag_uid && scan.tag_uid === cp.tag_uid));
            return (
              <div key={cp.id} style={{
                background: scanned ? '#0a1a0a' : '#0a0a0a',
                border: `1px solid ${scanned ? '#166534' : '#1f1f1f'}`,
                borderRadius: 8, padding: '12px 16px', marginBottom: 8,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{cp.checkpoint_name || cp.name}</div>
                  <div style={{ color: '#555', fontSize: 12 }}>
                    Order: {cp.checkpoint_order}
                    {cp.tag_uid ? ' · NFC' : ''}
                    {hasCoordinates(cp) ? ' · GPS' : ''}
                  </div>
                </div>
                {scanned
                  ? <span style={{ color: '#22c55e', fontSize: 13, fontWeight: 600 }}>Reached</span>
                  : <span style={{ color: '#555', fontSize: 13 }}>Pending</span>
                }
              </div>
            );
          })
        )}
      </div>

      {scans.length > 0 && (
        <div>
          <h2 style={{ fontSize: 15, color: '#fff', marginBottom: 12 }}>Recent Scans</h2>
          {scans.map((scan, index) => (
            <div key={`${scan.id}-${index}`} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '10px 16px', marginBottom: 6 }}>
              <div style={{ color: '#fff', fontWeight: 600 }}>{scan.checkpoint_name || 'Checkpoint scan'}</div>
              <div style={{ color: '#555', fontSize: 12 }}>
                {new Date(scan.scanned_at).toLocaleTimeString()}{scan.method === 'gps' ? ' · GPS' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
