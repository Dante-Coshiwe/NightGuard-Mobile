import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNFC } from '../hooks/useNFC';
import { logNFCScan, getNFCCheckpoints } from '../services/api';
import './screens.css';

export default function PatrolTrackingScreen() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const patrol = state?.patrol;

  const [checkpoints, setCheckpoints] = useState([]);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanFeedback, setScanFeedback] = useState(null);

  const { isSupported, scanning, error: nfcError, startScan, stopScan } = useNFC();

  useEffect(() => {
    loadCheckpoints();
    return () => stopScan();
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

  const handleNFCScan = async (tagUid) => {
    try {
      const result = await logNFCScan({
        tag_uid: tagUid,
        patrol_id: patrol?.id || null,
      });
      setScanFeedback({ success: true, message: `✓ ${result.checkpoint_name}` });
      setScans(prev => [result.scan, ...prev]);
      setTimeout(() => setScanFeedback(null), 3000);
    } catch (err) {
      setScanFeedback({ success: false, message: err.response?.data?.error || 'Unknown tag' });
      setTimeout(() => setScanFeedback(null), 3000);
    }
  };

  const handleStartScanning = () => {
    startScan(handleNFCScan);
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

      {/* NFC Status */}
      <div style={{ background: '#0a0a0a', border: `1px solid ${scanning ? '#22c55e' : '#1f1f1f'}`, borderRadius: 12, padding: 20, marginBottom: 20, textAlign: 'center' }}>
        {!isSupported ? (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📵</div>
            <div style={{ color: '#f87171', fontSize: 14 }}>NFC not supported</div>
            <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>Use Chrome on Android to scan NFC tags</div>
          </div>
        ) : scanning ? (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
            <div style={{ color: '#22c55e', fontSize: 16, fontWeight: 600 }}>Ready to scan</div>
            <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>Hold phone near NFC tag</div>
            <button onClick={stopScan}
              style={{ marginTop: 12, padding: '8px 20px', background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Stop Scanning
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏷️</div>
            <div style={{ color: '#fff', fontSize: 14, marginBottom: 12 }}>Tap to start scanning checkpoints</div>
            <button onClick={handleStartScanning}
              style={{ padding: '10px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Start Scanning
            </button>
          </div>
        )}
        {nfcError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{nfcError}</div>}
      </div>

      {/* Scan Feedback */}
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

      {/* Checkpoints */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: '#fff', marginBottom: 12 }}>
          Checkpoints ({checkpoints.length})
        </h2>
        {loading ? (
          <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>Loading...</div>
        ) : checkpoints.length === 0 ? (
          <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>No checkpoints registered for this site</div>
        ) : (
          checkpoints.map((cp, i) => {
            const scanned = scans.some(s => s.checkpoint_id === cp.id);
            return (
              <div key={cp.id} style={{
                background: scanned ? '#0a1a0a' : '#0a0a0a',
                border: `1px solid ${scanned ? '#166534' : '#1f1f1f'}`,
                borderRadius: 8, padding: '12px 16px', marginBottom: 8,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{cp.checkpoint_name}</div>
                  <div style={{ color: '#555', fontSize: 12 }}>Order: {cp.checkpoint_order}</div>
                </div>
                {scanned
                  ? <span style={{ color: '#22c55e', fontSize: 13, fontWeight: 600 }}>✓ Scanned</span>
                  : <span style={{ color: '#555', fontSize: 13 }}>Pending</span>
                }
              </div>
            );
          })
        )}
      </div>

      {/* Recent Scans */}
      {scans.length > 0 && (
        <div>
          <h2 style={{ fontSize: 15, color: '#fff', marginBottom: 12 }}>Recent Scans</h2>
          {scans.map((scan, i) => (
            <div key={i} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '10px 16px', marginBottom: 6 }}>
              <div style={{ color: '#fff', fontWeight: 600 }}>{scan.checkpoint_name}</div>
              <div style={{ color: '#555', fontSize: 12 }}>{new Date(scan.scanned_at).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}