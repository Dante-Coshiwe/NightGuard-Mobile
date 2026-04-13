import React, { useEffect, useState } from 'react';
import { addGuardUser, getGuards, toggleGuardActive, updateGuardPin } from '../services/api';
import { getCachedGuards, getQuickSwitchEnabled, saveCachedGuards, saveQuickSwitchEnabled } from '../lib/deviceStore';

const pageStyles = {
  page: { padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh' },
  card: { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 14, padding: 20, marginBottom: 18 },
  input: { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', boxSizing: 'border-box' },
  button: { padding: '10px 16px', background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' },
  subtleButton: { padding: '8px 12px', background: '#151515', border: '1px solid #333', borderRadius: 10, color: '#d4d4d4', cursor: 'pointer' },
};

export default function UsersConfig() {
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPin, setNewPin] = useState('1234');
  const [quickSwitchEnabled, setQuickSwitch] = useState(getQuickSwitchEnabled());

  useEffect(() => {
    loadGuards();
  }, []);

  const loadGuards = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getGuards();
      setGuards(data);
      saveCachedGuards(data);
    } catch {
      const cached = getCachedGuards();
      setGuards(cached);
      if (!cached.length) {
        setError('Unable to load guards right now');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddGuard = async () => {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }

    try {
      const guard = await addGuardUser({ full_name: newName, phone: newPhone, pin: newPin });
      const updated = [...guards, guard];
      setGuards(updated);
      saveCachedGuards(updated);
      setNewName('');
      setNewPhone('');
      setNewPin('1234');
      setShowAddForm(false);
      setSuccess(`${guard.full_name} added`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add guard');
    }
  };

  const handlePinUpdate = async (guardId, pin) => {
    try {
      await updateGuardPin(guardId, pin);
      const updated = guards.map((guard) => (
        guard.id === guardId ? { ...guard, pin } : guard
      ));
      setGuards(updated);
      saveCachedGuards(updated);
      setSuccess('Guard PIN updated');
    } catch {
      setError('Failed to update guard PIN');
    }
  };

  const handleToggle = async (guardId, isActive) => {
    try {
      await toggleGuardActive(guardId, !isActive);
      const updated = guards.map((guard) => (
        guard.id === guardId ? { ...guard, is_active: !isActive } : guard
      ));
      setGuards(updated);
      saveCachedGuards(updated);
    } catch {
      setError('Failed to update guard status');
    }
  };

  const handleQuickSwitchToggle = () => {
    const nextValue = !quickSwitchEnabled;
    setQuickSwitch(nextValue);
    saveQuickSwitchEnabled(nextValue);
    setSuccess(`Quick guard switching ${nextValue ? 'enabled' : 'disabled'}`);
  };

  return (
    <div style={pageStyles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Users Configuration</h1>
          <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>Admin view includes guard PINs and device quick-switch control.</p>
        </div>
        <button style={pageStyles.button} onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Close' : 'Add Guard'}
        </button>
      </div>

      {error && <div style={{ ...pageStyles.card, color: '#fca5a5', borderColor: '#7f1d1d' }}>{error}</div>}
      {success && <div style={{ ...pageStyles.card, color: '#86efac', borderColor: '#166534' }}>{success}</div>}

      <div style={pageStyles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Quick guard switching</h2>
            <p style={{ margin: 0, color: '#8b8b8b', fontSize: 14 }}>Lets guards hand over the shared device without ending the shift.</p>
          </div>
          <button style={pageStyles.subtleButton} onClick={handleQuickSwitchToggle}>
            {quickSwitchEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div style={pageStyles.card}>
          <h2 style={{ marginTop: 0 }}>Add Guard</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <input style={pageStyles.input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
            <input style={pageStyles.input} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone number" />
            <input style={pageStyles.input} value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="PIN" maxLength={6} />
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={pageStyles.button} onClick={handleAddGuard}>Save Guard</button>
          </div>
        </div>
      )}

      <div style={pageStyles.card}>
        <h2 style={{ marginTop: 0 }}>Guards</h2>
        {loading ? (
          <p style={{ color: '#8b8b8b' }}>Loading guards...</p>
        ) : guards.length === 0 ? (
          <p style={{ color: '#8b8b8b' }}>No guards available yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {guards.map((guard) => (
              <div key={guard.id} style={{ border: '1px solid #1f1f1f', borderRadius: 12, padding: 14, background: '#111' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{guard.full_name}</div>
                    <div style={{ color: '#8b8b8b', fontSize: 13, marginTop: 4 }}>{guard.phone || 'No phone saved'}</div>
                    <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>PIN: {guard.pin || guard.guard_pin || '1234'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button style={pageStyles.subtleButton} onClick={() => handlePinUpdate(guard.id, prompt('New guard PIN', guard.pin || guard.guard_pin || '1234') || guard.pin)}>
                      Change PIN
                    </button>
                    <button style={pageStyles.subtleButton} onClick={() => handleToggle(guard.id, guard.is_active)}>
                      {guard.is_active === false ? 'Activate' : 'Deactivate'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
