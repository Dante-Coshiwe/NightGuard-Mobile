import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getGuardsBySite } from '../services/api';
import './screens.css';

const SITE_ID = import.meta.env.VITE_SITE_ID;

export default function LoginScreen() {
  const [mode, setMode] = useState('select'); // 'select', 'admin', 'guard'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [guards, setGuards] = useState([]);
  const [selectedGuard, setSelectedGuard] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, guardLogin } = useAuth();
  const navigate = useNavigate();

  const loadGuards = async () => {
    // Try cache first if offline
    if (!navigator.onLine) {
      const cached = localStorage.getItem('nightguard_cached_guards');
      if (cached) { setGuards(JSON.parse(cached)); setMode('guard'); return; }
      setError('No internet and no cached guard list'); return;
    }
    setLoading(true);
    try {
      const data = await getGuardsBySite(SITE_ID);
      setGuards(data);
      localStorage.setItem('nightguard_cached_guards', JSON.stringify(data));
      setMode('guard');
    } catch (err) {
      // Server unreachable - fall back to cache
      const cached = localStorage.getItem('nightguard_cached_guards');
      if (cached) {
        setGuards(JSON.parse(cached));
        setMode('guard');
      } else {
        setError('Cannot reach server and no cached data. Connect to internet first.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate('/');
    } catch (err) {
      if (!navigator.onLine || err.message?.includes('Network')) {
        setError('No internet connection. Guard login available offline if previously logged in.');
      } else {
        setError('Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuardLogin = async () => {
    if (!selectedGuard) { setError('Please select your name'); return; }
    if (!pin) { setError('Please enter your PIN'); return; }
    setError('');
    setLoading(true);
    try {
      await guardLogin(selectedGuard, pin);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-inner">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 56, height: 56, background: '#dc2626', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 28 }}></div>
          <h1 style={{ color: '#fff', margin: 0, fontSize: 22, fontWeight: 600 }}>NightGuard</h1>
          <p style={{ color: '#666', margin: '6px 0 0', fontSize: 14 }}>Security Management</p>
        </div>

        {error && <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: 8, padding: '10px 12px', color: '#ff6b6b', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {/* Mode Selection */}
        {mode === 'select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => setMode('admin')}
              style={{ width: '100%', padding: 14, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Admin Login
            </button>
            <button onClick={loadGuards} disabled={loading}
              style={{ width: '100%', padding: 14, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              {loading ? 'Loading...' : 'Guard Login'}
            </button>
          </div>
        )}

        {/* Admin Login */}
        {mode === 'admin' && (
          <form onSubmit={handleAdminLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <button type="button" onClick={() => { setMode('select'); setError(''); }}
              style={{ width: '100%', padding: 10, background: 'none', border: 'none', color: '#666', fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
              ? Back
            </button>
          </form>
        )}

        {/* Guard Login */}
        {mode === 'guard' && (
          <div>
            <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>Select Your Name</label>
            <select value={selectedGuard} onChange={e => setSelectedGuard(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}>
              <option value="">-- Select Guard --</option>
              {guards.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
            </select>
            <label style={{ color: '#999', fontSize: 13, display: 'block', marginBottom: 6 }}>PIN</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="Enter PIN"
              style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14, marginBottom: 24, boxSizing: 'border-box' }}
              inputMode="numeric" maxLength={6} />
            <button onClick={handleGuardLogin} disabled={loading}
              style={{ width: '100%', padding: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {loading ? 'Logging in...' : 'Start Shift & Login'}
            </button>
            <button type="button" onClick={() => { setMode('select'); setError(''); setPin(''); setSelectedGuard(''); }}
              style={{ width: '100%', padding: 10, background: 'none', border: 'none', color: '#666', fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
              ? Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
