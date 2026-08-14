import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, LogIn, LogOut, User, CheckCircle, XCircle } from 'lucide-react';
import api from '../services/api';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { GENERAL_GUARD, GENERAL_GUARD_ID, getShiftSession } from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';

function getShiftLabel() {
  return new Date().getHours() >= 18 || new Date().getHours() < 6 ? 'Night Shift' : 'Day Shift';
}

export default function ShiftManagementScreen() {
  const navigate = useNavigate();
  const { logout, startShiftLogin } = useAuth();
  const [currentShift, setCurrentShift] = useState(null);
  const [loading, setLoading] = useState(false);
  const { post } = useOfflineApi();

  useEffect(() => {
    fetchCurrentShift();
  }, []);

  const fetchCurrentShift = async () => {
    try {
      const res = await api.get('/shifts/current');
      setCurrentShift(res.data);
    } catch (err) {
      const cachedShift = getShiftSession();
      if (cachedShift) {
        setCurrentShift({
          guard_name: cachedShift.activeGuardName || GENERAL_GUARD.full_name,
          start_time: cachedShift.startedAt,
          _offline: true,
        });
      } else {
        setCurrentShift(null);
      }
      console.error('Failed to fetch current shift', err);
    }
  };

  const startShift = async () => {
    setLoading(true);
    try {
      const shiftLabel = getShiftLabel();
      const result = await startShiftLogin({
        guardId: GENERAL_GUARD_ID,
        pin: null,
        shiftLabel,
      });
      const shift = result.shift;
      setCurrentShift({
        ...shift,
        guard_name: GENERAL_GUARD.full_name,
        start_time: shift.startedAt,
        _offline: true,
      });
      alert('Shift saved offline and will sync later');
      fetchCurrentShift();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const endShift = async () => {
    setLoading(true);
    try {
      // Carry the sign-off time in the payload, not just in the optimistic response —
      // it is what endShiftRecord writes, and without it a shift ended with no signal is
      // stamped with whenever the queue happened to drain.
      const endedAt = new Date().toISOString();
      const result = await post(
        '/shifts/end',
        {
          ...(currentShift?.id ? { shift_id: currentShift.id } : {}),
          ended_at: endedAt,
          end_reason: 'guard_ended_shift',
        },
        {
          clientTempId: `shift_end_${Date.now()}`,
          offlineResponse: {
            shift_id: currentShift?.id || null,
            ended_at: endedAt,
            _offline: true,
          },
        }
      );
      alert(result?._offline ? 'Shift end saved offline and will sync later' : 'Shift ended successfully');
      setCurrentShift(null);
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Shift Management</h1>

      <div style={styles.currentShift}>
        <h2 style={styles.subtitle}>Current Shift</h2>
        {currentShift ? (
          <div style={styles.shiftCard}>
            <div style={styles.shiftInfo}>
              <User size={20} color="#dc2626" />
              <span style={styles.shiftText}>{currentShift.guard_name || GENERAL_GUARD.full_name}</span>
            </div>
            <div style={styles.shiftInfo}>
              <Clock size={20} color="#dc2626" />
              <span style={styles.shiftText}>Started: {new Date(currentShift.start_time).toLocaleString()}</span>
            </div>
            <div style={styles.shiftInfo}>
              <CheckCircle size={20} color="#10b981" />
              <span style={styles.shiftText}>
                Status: {currentShift._offline ? 'Pending Sync' : 'Active'}
              </span>
            </div>
            <button onClick={endShift} disabled={loading} style={styles.endButton}>
              <LogOut size={18} />
              End Shift
            </button>
          </div>
        ) : (
          <div style={styles.noShiftCard}>
            <XCircle size={32} color="#666" />
            <p style={styles.noShiftText}>No active shift</p>
          </div>
        )}
      </div>

      <div style={styles.startShift}>
        <h2 style={styles.subtitle}>Start New Shift</h2>
        <div style={styles.form}>
          <div style={styles.guardName}>{GENERAL_GUARD.full_name}</div>
          <div style={styles.helperText}>All activity on this device is recorded under this location guard.</div>
          <button onClick={startShift} disabled={loading} style={styles.startButton}>
            <LogIn size={18} />
            Start Shift
          </button>
        </div>
      </div>

      <button onClick={() => navigate('/')} style={styles.backButton}>
        Back to Home
      </button>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#000000', minHeight: 'var(--app-viewport-height, 100dvh)', padding: '20px' },
  title: { color: '#ffffff', fontSize: '24px', fontWeight: 'bold', marginBottom: '24px' },
  subtitle: { color: '#ffffff', fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' },
  currentShift: { marginBottom: '32px' },
  shiftCard: { backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '20px' },
  shiftInfo: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' },
  shiftText: { color: '#fff', fontSize: '14px' },
  endButton: {
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  noShiftCard: { backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '40px', textAlign: 'center' },
  noShiftText: { color: '#666', marginTop: '12px' },
  startShift: { marginBottom: '32px' },
  form: { backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '20px' },
  guardName: { color: '#fff', fontSize: '16px', fontWeight: 700, marginBottom: '6px' },
  helperText: { color: '#8b8b8b', fontSize: '13px', marginBottom: '16px' },
  startButton: {
    backgroundColor: '#10b981',
    color: '#fff',
    border: 'none',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  backButton: {
    backgroundColor: '#333',
    color: '#fff',
    border: 'none',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    width: '100%',
    marginTop: '16px',
  },
};
