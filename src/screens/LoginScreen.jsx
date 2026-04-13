import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getLookupData } from '../lib/deviceStore';
import './screens.css';

export default function LoginScreen() {
  const [mode, setMode] = useState('select');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedGuard, setSelectedGuard] = useState('');
  const [selectedShift, setSelectedShift] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, startShiftLogin, loadGuards, guards } = useAuth();
  const navigate = useNavigate();

  const lookupData = useMemo(() => getLookupData(), []);

  const handleLoadShiftMode = async () => {
    setLoading(true);
    setError('');
    try {
      await loadGuards();
      setMode('shift');
      setSelectedShift(lookupData.shiftOptions[0] || 'Day Shift');
    } catch (err) {
      setError('Unable to load guards for this site');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleShiftLogin = async (e) => {
    e.preventDefault();
    if (!selectedShift) {
      setError('Please select a shift');
      return;
    }
    if (!selectedGuard) {
      setError('Please select the active guard');
      return;
    }
    if (!pin.trim()) {
      setError('Please enter the guard PIN');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await startShiftLogin({
        guardId: selectedGuard,
        pin,
        shiftLabel: selectedShift,
      });
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unable to start shift');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-inner">
        <div className="login-brand">
          <div className="login-brand-mark">NG</div>
          <h1 className="login-brand-title">NightGuard</h1>
          <p className="login-brand-copy">Secure site logging, patrol tracking, and shift-based access.</p>
        </div>

        {error && <div className="status-banner error">{error}</div>}

        {mode === 'select' && (
          <div className="login-stack">
            <button className="button-submit primary" onClick={handleLoadShiftMode} disabled={loading}>
              {loading ? 'Loading guards...' : 'Shift Login'}
            </button>
            <button className="button-submit" onClick={() => setMode('admin')} disabled={loading}>
              Admin Login
            </button>
          </div>
        )}

        {mode === 'admin' && (
          <form onSubmit={handleAdminLogin} className="login-stack">
            <div>
              <label className="login-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="login-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="button-submit primary" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <button className="button-text" type="button" onClick={() => { setMode('select'); setError(''); }}>
              Back
            </button>
          </form>
        )}

        {mode === 'shift' && (
          <form onSubmit={handleShiftLogin} className="login-stack">
            <div className="status-banner neutral">
              All guards use the same device. Start the shift once, then switch guards quickly from the home screen.
            </div>

            <div>
              <label className="login-label">Shift</label>
              <select className="form-input" value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)}>
                {lookupData.shiftOptions.map((shift) => (
                  <option key={shift} value={shift}>{shift}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="login-label">Active Guard</label>
              <select className="form-input" value={selectedGuard} onChange={(e) => setSelectedGuard(e.target.value)}>
                <option value="">Select guard</option>
                {guards.map((guard) => (
                  <option key={guard.id} value={guard.id}>
                    {guard.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="login-label">Guard PIN</label>
              <input
                className="form-input"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="Enter PIN"
              />
            </div>

            <button className="button-submit primary" type="submit" disabled={loading}>
              {loading ? 'Starting shift...' : 'Start Shift'}
            </button>
            <button className="button-text" type="button" onClick={() => { setMode('select'); setError(''); }}>
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
