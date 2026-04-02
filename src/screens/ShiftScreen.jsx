import React, { useState, useEffect } from 'react';
import { getActiveShift, getGuardsList, startShift, endShift } from '../services/api';
import './screens.css';

export default function ShiftScreen() {
  const [activeShift, setActiveShift] = useState(null);
  const [guards, setGuards] = useState([]);
  const [selectedGuard, setSelectedGuard] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [shift, guardsList] = await Promise.all([
        getActiveShift(),
        getGuardsList(),
      ]);
      setActiveShift(shift);
      setGuards(guardsList);
    } catch (err) {
      setError('Failed to load shift data');
    } finally {
      setLoading(false);
    }
  };

  const handleStartShift = async () => {
    if (!selectedGuard) {
      setError('Please select a guard');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const shift = await startShift({ guard_id: selectedGuard, shift_name: shiftName || 'Shift' });
      setActiveShift({ ...shift, guard_name: guards.find(g => g.id === selectedGuard)?.full_name });
      setSelectedGuard('');
      setShiftName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start shift');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndShift = async () => {
    if (!window.confirm('Are you sure you want to end this shift?')) return;
    setSubmitting(true);
    try {
      await endShift({ shift_id: activeShift.id });
      setActiveShift(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to end shift');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', backgroundColor: '#000' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="form-container">
      <h1 className="form-title">Shift Management</h1>
      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}

      {activeShift ? (
        <div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <div style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>● Active Shift</div>
            <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{activeShift.guard_name}</div>
            <div style={{ color: '#666', fontSize: 13 }}>Started: {formatTime(activeShift.started_at)}</div>
            {activeShift.shift_name && <div style={{ color: '#666', fontSize: 13 }}>Shift: {activeShift.shift_name}</div>}
          </div>
          <button
            onClick={handleEndShift}
            disabled={submitting}
            style={{ width: '100%', padding: 14, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            {submitting ? 'Ending Shift...' : 'End Shift'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ color: '#666', fontSize: 14, marginBottom: 24, textAlign: 'center' }}>No active shift. Select a guard to start.</div>
          <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Select Guard</label>
          <select
            value={selectedGuard}
            onChange={(e) => setSelectedGuard(e.target.value)}
            className="form-input"
            style={{ marginBottom: 16 }}
          >
            <option value="">-- Select Guard --</option>
            {guards.map((g) => (
              <option key={g.id} value={g.id}>{g.full_name}</option>
            ))}
          </select>
          <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Shift Name (optional)</label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Night Shift"
            value={shiftName}
            onChange={(e) => setShiftName(e.target.value)}
            style={{ marginBottom: 24 }}
          />
          <button
            onClick={handleStartShift}
            disabled={submitting}
            style={{ width: '100%', padding: 14, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            {submitting ? 'Starting Shift...' : 'Start Shift'}
          </button>
        </div>
      )}
    </div>
  );
}