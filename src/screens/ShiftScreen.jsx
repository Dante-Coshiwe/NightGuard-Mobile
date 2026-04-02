import React, { useState, useEffect } from 'react';
import { getActiveShift, getGuardsList, startShift, endShift, addGuard } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import './screens.css';

export default function ShiftScreen() {
  const { user } = useAuth();
  const isAdmin = user?.user_type === 'admin';

  const [activeShift, setActiveShift] = useState(null);
  const [guards, setGuards] = useState([]);
  const [selectedGuard, setSelectedGuard] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add guard form
  const [showAddGuard, setShowAddGuard] = useState(false);
  const [newGuardName, setNewGuardName] = useState('');
  const [newGuardPhone, setNewGuardPhone] = useState('');
  const [addingGuard, setAddingGuard] = useState(false);

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
    if (!selectedGuard) { setError('Please select a guard'); return; }
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

  const handleAddGuard = async () => {
    if (!newGuardName.trim()) { setError('Guard name is required'); return; }
    setError('');
    setAddingGuard(true);
    try {
      const newGuard = await addGuard({ full_name: newGuardName.trim(), phone: newGuardPhone.trim() });
      setGuards([...guards, newGuard]);
      setNewGuardName('');
      setNewGuardPhone('');
      setShowAddGuard(false);
      setSuccess(`${newGuard.full_name} added successfully`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add guard');
    } finally {
      setAddingGuard(false);
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
      {success && <div style={{ color: '#22c55e', marginBottom: '16px', textAlign: 'center' }}>{success}</div>}

      {/* Active Shift */}
      {activeShift ? (
        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>● Active Shift</div>
          <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{activeShift.guard_name}</div>
          <div style={{ color: '#666', fontSize: 13 }}>Started: {formatTime(activeShift.started_at)}</div>
          {activeShift.shift_name && <div style={{ color: '#666', fontSize: 13 }}>Shift: {activeShift.shift_name}</div>}
          {isAdmin && (
            <button onClick={handleEndShift} disabled={submitting} style={{ marginTop: 16, width: '100%', padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {submitting ? 'Ending Shift...' : 'End Shift'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>No active shift</div>
          {isAdmin && (
            <>
              <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Select Guard</label>
              <select value={selectedGuard} onChange={e => setSelectedGuard(e.target.value)} className="form-input" style={{ marginBottom: 12 }}>
                <option value="">-- Select Guard --</option>
                {guards.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
              </select>
              <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Shift Name (optional)</label>
              <input type="text" className="form-input" placeholder="e.g. Night Shift" value={shiftName} onChange={e => setShiftName(e.target.value)} style={{ marginBottom: 16 }} />
              <button onClick={handleStartShift} disabled={submitting} style={{ width: '100%', padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {submitting ? 'Starting Shift...' : 'Start Shift'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Guards List */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 600, margin: 0 }}>Guards ({guards.length})</h2>
          {isAdmin && (
            <button onClick={() => setShowAddGuard(!showAddGuard)} style={{ padding: '6px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              {showAddGuard ? 'Cancel' : '+ Add Guard'}
            </button>
          )}
        </div>

        {/* Add Guard Form */}
        {showAddGuard && isAdmin && (
          <div style={{ background: '#0a0a0a', border: '1px solid #333', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: '#fff', fontSize: 14, marginBottom: 12 }}>New Guard</h3>
            <input type="text" className="form-input" placeholder="Full Name *" value={newGuardName} onChange={e => setNewGuardName(e.target.value)} style={{ marginBottom: 10 }} />
            <input type="tel" className="form-input" placeholder="Phone (optional)" value={newGuardPhone} onChange={e => setNewGuardPhone(e.target.value)} style={{ marginBottom: 12 }} />
            <button onClick={handleAddGuard} disabled={addingGuard} style={{ width: '100%', padding: 10, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {addingGuard ? 'Adding...' : 'Add Guard'}
            </button>
          </div>
        )}

        {/* Guards List */}
        {guards.length === 0 ? (
          <div style={{ color: '#666', fontSize: 13, textAlign: 'center', padding: 20 }}>No guards added yet</div>
        ) : (
          <div>
            {guards.map(g => (
              <div key={g.id} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{g.full_name}</div>
                  {g.phone && <div style={{ color: '#666', fontSize: 12 }}>{g.phone}</div>}
                </div>
                {isAdmin && !activeShift && (
                  <button onClick={() => { setSelectedGuard(g.id); }} style={{ padding: '4px 10px', background: selectedGuard === g.id ? '#dc2626' : '#1a1a1a', border: '1px solid #333', color: '#fff', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                    {selectedGuard === g.id ? '✓ Selected' : 'Select'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}