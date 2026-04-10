import React, { useState, useEffect } from 'react';
import { getGuards, addGuardUser, updateGuardPin, toggleGuardActive } from '../services/api';

export default function UsersConfig() {
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPin, setNewPin] = useState('1234');
  const [adding, setAdding] = useState(false);
  const [editingPin, setEditingPin] = useState(null);
  const [newPinValue, setNewPinValue] = useState('');

  useEffect(() => { loadGuards(); }, []);

  const loadGuards = async () => {
    setLoading(true);
    try {
      const data = await getGuards();
      setGuards(data);
    } catch {
      setError('Failed to load guards');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGuard = async () => {
    if (!newName.trim()) { setError('Name is required'); return; }
    setAdding(true);
    setError('');
    try {
      const guard = await addGuardUser({ full_name: newName, phone: newPhone, pin: newPin });
      setGuards([...guards, guard]);
      setNewName(''); setNewPhone(''); setNewPin('1234');
      setShowAddForm(false);
      setSuccess(`${guard.full_name} added with PIN: ${newPin}`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add guard');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdatePin = async (id) => {
    if (!newPinValue.trim()) return;
    try {
      await updateGuardPin(id, newPinValue);
      setEditingPin(null);
      setNewPinValue('');
      setSuccess('PIN updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Failed to update PIN');
    }
  };

  const handleToggle = async (id, currentStatus) => {
    try {
      const updated = await toggleGuardActive(id, !currentStatus);
      setGuards(guards.map(g => g.id === id ? { ...g, is_active: updated.is_active } : g));
    } catch {
      setError('Failed to update guard status');
    }
  };

  return (
    <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Users</h1>
        <button onClick={() => setShowAddForm(!showAddForm)}
          style={{ padding: '10px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {showAddForm ? 'Cancel' : '+ Add Guard'}
        </button>
      </div>

      {error && <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: 8, padding: '10px 16px', color: '#ff6b6b', marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ background: '#0f2a1a', border: '1px solid #166534', borderRadius: 8, padding: '10px 16px', color: '#86efac', marginBottom: 16 }}>{success}</div>}

      {showAddForm && (
        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>New Guard</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <input type="text" placeholder="Full Name *" value={newName} onChange={e => setNewName(e.target.value)}
              style={{ flex: 1, minWidth: 150, padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14 }} />
            <input type="tel" placeholder="Phone (optional)" value={newPhone} onChange={e => setNewPhone(e.target.value)}
              style={{ flex: 1, minWidth: 150, padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14 }} />
            <input type="text" placeholder="PIN" value={newPin} onChange={e => setNewPin(e.target.value)} maxLength={6}
              style={{ width: 80, padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14 }} />
          </div>
          <button onClick={handleAddGuard} disabled={adding}
            style={{ padding: '10px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {adding ? 'Adding...' : 'Add Guard'}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading guards...</div>
      ) : guards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>No guards added yet</div>
      ) : (
        <div>
          {guards.map(guard => (
            <div key={guard.id} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: '16px 20px', marginBottom: 12, opacity: guard.is_active ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>{guard.full_name}</div>
                  {guard.phone && <div style={{ color: '#666', fontSize: 13, marginTop: 2 }}>{guard.phone}</div>}
                  <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>{guard.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {editingPin === guard.id ? (
                    <>
                      <input type="text" placeholder="New PIN" value={newPinValue} onChange={e => setNewPinValue(e.target.value)} maxLength={6} autoFocus
                        style={{ width: 80, padding: '6px 10px', background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 13 }} />
                      <button onClick={() => handleUpdatePin(guard.id)}
                        style={{ padding: '6px 12px', background: '#166534', border: 'none', borderRadius: 6, color: '#86efac', fontSize: 12, cursor: 'pointer' }}>
                        Save
                      </button>
                      <button onClick={() => { setEditingPin(null); setNewPinValue(''); }}
                        style={{ padding: '6px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#999', fontSize: 12, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setEditingPin(guard.id); setNewPinValue(''); }}
                      style={{ padding: '6px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, cursor: 'pointer' }}>
                      Change PIN
                    </button>
                  )}
                  <button onClick={() => handleToggle(guard.id, guard.is_active)}
                    style={{ padding: '6px 12px', background: guard.is_active ? '#1a1a1a' : '#166534', border: `1px solid ${guard.is_active ? '#333' : '#166534'}`, borderRadius: 6, color: guard.is_active ? '#ef4444' : '#86efac', fontSize: 12, cursor: 'pointer' }}>
                    {guard.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: guard.is_active ? '#166534' : '#333', color: guard.is_active ? '#86efac' : '#666' }}>
                  {guard.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}