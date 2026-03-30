import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, LogIn, LogOut, User, CheckCircle, XCircle } from 'lucide-react';
import api from '../services/api';

export default function ShiftManagementScreen() {
  const navigate = useNavigate();
  const [currentShift, setCurrentShift] = useState(null);
  const [guards, setGuards] = useState([]);
  const [selectedGuard, setSelectedGuard] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCurrentShift();
    fetchAvailableGuards();
  }, []);

  const fetchCurrentShift = async () => {
    try {
      const res = await api.get('/shifts/current');
      setCurrentShift(res.data);
    } catch (err) {
      console.error('Failed to fetch current shift', err);
    }
  };

  const fetchAvailableGuards = async () => {
    try {
      const res = await api.get('/guards/available');
      setGuards(res.data);
    } catch (err) {
      console.error('Failed to fetch guards', err);
    }
  };

  const startShift = async () => {
    if (!selectedGuard) {
      alert('Please select a guard');
      return;
    }
    setLoading(true);
    try {
      await api.post('/shifts/start', { guardId: selectedGuard });
      alert('Shift started successfully');
      fetchCurrentShift();
      setSelectedGuard('');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const endShift = async () => {
    setLoading(true);
    try {
      await api.post('/shifts/end');
      alert('Shift ended successfully');
      fetchCurrentShift();
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
              <span style={styles.shiftText}>{currentShift.guard_name}</span>
            </div>
            <div style={styles.shiftInfo}>
              <Clock size={20} color="#dc2626" />
              <span style={styles.shiftText}>Started: {new Date(currentShift.start_time).toLocaleString()}</span>
            </div>
            <div style={styles.shiftInfo}>
              <CheckCircle size={20} color="#10b981" />
              <span style={styles.shiftText}>Status: Active</span>
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
          <label style={styles.label}>Select Guard</label>
          <select value={selectedGuard} onChange={(e) => setSelectedGuard(e.target.value)} style={styles.select}>
            <option value="">-- Choose Guard --</option>
            {guards.map(guard => (
              <option key={guard.id} value={guard.id}>{guard.name}</option>
            ))}
          </select>
          <button onClick={startShift} disabled={loading || !selectedGuard} style={styles.startButton}>
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
  container: { backgroundColor: '#000000', minHeight: '100vh', padding: '20px' },
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
  label: { display: 'block', color: '#999', fontSize: '13px', marginBottom: '8px' },
  select: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#1a1a1a',
    color: '#fff',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '16px',
  },
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