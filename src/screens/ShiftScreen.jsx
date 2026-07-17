import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActiveShift } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import './screens.css';
import { GENERAL_GUARD, GENERAL_GUARD_ID, getLookupData, getShiftSession } from '../lib/deviceStore';
import EndShiftModal from '../components/EndShiftModal';
import KioskService from '../services/kioskService';

function KioskStatusCard() {
  const [status, setStatus] = useState(null);
  const [relocking, setRelocking] = useState(false);

  const refresh = async () => {
    setStatus(await KioskService.getStatus());
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  if (!status?.active) return null;

  const locked = status.locked;
  const unsupported = !status.supported;
  const tone = locked ? '#166534' : unsupported ? '#3f3f46' : '#7f1d1d';
  const accent = locked ? '#22c55e' : unsupported ? '#a3a3a3' : '#fca5a5';
  const label = locked
    ? 'Device locked'
    : unsupported
      ? 'Kiosk lock not supported on this device'
      : 'Device NOT locked';
  const detail = locked
    ? `Screen is pinned (${status.lockState}). Guards cannot leave the app.`
    : unsupported
      ? 'This build/emulator has no native lock. The app stays in kiosk layout but the OS is not pinned.'
      : 'Screen pinning is off. Tap "Re-lock device" to pin it, or enable screen pinning in Android settings.';

  const handleRelock = async () => {
    setRelocking(true);
    try {
      await KioskService.ensureActive();
      await refresh();
    } finally {
      setRelocking(false);
    }
  };

  return (
    <div style={{ background: '#0a0a0a', border: `1px solid ${tone}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: accent, display: 'inline-block' }} />
        <span style={{ color: accent, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.45 }}>{detail}</div>
      {!locked && !unsupported && (
        <button
          onClick={handleRelock}
          disabled={relocking}
          style={{ marginTop: 14, width: '100%', padding: 11, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: relocking ? 0.6 : 1 }}
        >
          {relocking ? 'Locking...' : 'Re-lock device'}
        </button>
      )}
    </div>
  );
}

function getCanonicalShiftLabel(label) {
  const value = String(label || '').toLowerCase();
  if (value.includes('night')) return 'Night Shift';
  if (value.includes('day')) return 'Day Shift';
  return new Date().getHours() >= 18 || new Date().getHours() < 6 ? 'Night Shift' : 'Day Shift';
}

export default function ShiftScreen() {
  const { user, startShiftLogin } = useAuth();
  const isAdmin = user?.user_type === 'admin';
  const navigate = useNavigate();

  const [activeShift, setActiveShift] = useState(null);
  const [shiftName, setShiftName] = useState('Day Shift');
  const [lookupData, setLookupData] = useState(getLookupData());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showEndShift, setShowEndShift] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleLookupUpdate = () => setLookupData(getLookupData());
    window.addEventListener('nightguard_lookup_updated', handleLookupUpdate);
    return () => window.removeEventListener('nightguard_lookup_updated', handleLookupUpdate);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const shift = await getActiveShift();
      setActiveShift(shift);
    } catch {
      const cachedShift = getShiftSession();
      setActiveShift(
        cachedShift
          ? {
              id: cachedShift.id || `shift_cached_${Date.now()}`,
              guard_name: cachedShift.activeGuardName || GENERAL_GUARD.full_name,
              started_at: cachedShift.startedAt,
              shift_name: cachedShift.shiftLabel,
              _offline: true,
            }
          : null
      );
      setError(cachedShift ? '' : 'Failed to load shift data');
    } finally {
      setLoading(false);
    }
  };

  const handleStartShift = async () => {
    const canonicalShift = getCanonicalShiftLabel(shiftName);
    setError('');
    setSubmitting(true);

    try {
      const result = await startShiftLogin({
        guardId: GENERAL_GUARD_ID,
        pin: null,
        shiftLabel: canonicalShift,
      });
      const shift = result.shift;
      setActiveShift({
        ...shift,
        guard_name: GENERAL_GUARD.full_name,
        started_at: shift.startedAt,
        shift_name: shift.shiftLabel,
        _offline: true,
      });
      setShiftName('Day Shift');
      setSuccess('Shift saved locally and will sync later');
      window.setTimeout(() => setSuccess(''), 2500);
      navigate('/');
    } catch (err) {
      if (err.code === 'ADMIN_PIN_NOT_SET') {
        alert(err.message);
        navigate('/setup/kiosk-pin', { replace: false, state: { initialSetup: true } });
        return;
      }
      setError(err.response?.data?.error || 'Failed to start shift');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (timestamp) => (timestamp ? new Date(timestamp).toLocaleString() : '');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', backgroundColor: '#000' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="form-container">
      {showEndShift && (
        <EndShiftModal
          activeShift={activeShift}
          onClose={() => setShowEndShift(false)}
          onEnded={() => {
            setActiveShift(null);
            setShowEndShift(false);
          }}
        />
      )}
      <h1 className="form-title">Shift Management</h1>

      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', marginBottom: '16px', textAlign: 'center' }}>{success}</div>}

      {activeShift && <KioskStatusCard />}

      {activeShift ? (
        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>Active Shift</div>
          <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{activeShift.guard_name || GENERAL_GUARD.full_name}</div>
          <div style={{ color: '#666', fontSize: 13 }}>Started: {formatTime(activeShift.started_at)}</div>
          {activeShift.shift_name && <div style={{ color: '#666', fontSize: 13 }}>Shift: {activeShift.shift_name}</div>}
          {isAdmin && (
            <button onClick={() => setShowEndShift(true)} disabled={submitting} style={{ marginTop: 16, width: '100%', padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {submitting ? 'Ending Shift...' : 'End Shift'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>No active shift</div>
          {isAdmin && (
            <>
              <div className="status-banner neutral">This shift will be recorded as {GENERAL_GUARD.full_name} for the location.</div>
              <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Shift</label>
              <select className="form-input" value={shiftName} onChange={(e) => setShiftName(e.target.value)} style={{ marginBottom: 16 }}>
                {lookupData.shiftOptions.map((shift) => (
                  <option key={shift} value={shift}>{shift}</option>
                ))}
              </select>
              <button onClick={handleStartShift} disabled={submitting} style={{ width: '100%', padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {submitting ? 'Starting Shift...' : 'Start Shift'}
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20 }}>
        <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>Guard</h2>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{GENERAL_GUARD.full_name}</div>
        <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>Single shared guard identity for this device and location.</div>
      </div>
    </div>
  );
}
