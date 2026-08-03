import React, { useEffect, useState } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { GENERAL_GUARD, GENERAL_GUARD_ID, getLocationName } from '../lib/deviceStore';
import { getAdminDeviceBinding } from '../lib/deviceBinding';
import { NIGHTGUARD_LOGO } from '../lib/nightguardLogo';
import { hasAdminPinHash } from '../services/kioskPinService';
import './screens.css';

export default function LoginScreen() {
  const [mode, setMode] = useState('select');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { login, startShiftLogin } = useAuth();
  const navigate = useNavigate();
  const locationName = getLocationName();

  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidHide', () => window.scrollTo(0, 0));
    return () => listener.then((handler) => handler.remove()).catch(() => null);
  }, []);

  useEffect(() => {
    let mounted = true;
    getAdminDeviceBinding().then((binding) => {
      if (mounted && binding?.admin_email) {
        setEmail(binding.admin_email);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      // A manager with more than one location picks which one this device is,
      // before anything else — the kiosk PIN belongs to a site.
      if (result?.needsSiteBinding) {
        navigate('/setup/site', { replace: true });
        return;
      }
      if (!(await hasAdminPinHash())) {
        navigate('/setup/kiosk-pin', { replace: true, state: { initialSetup: true } });
        return;
      }
      navigate('/');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  // Single-tap "go on duty" — no shift selection. The device operates as the shared General
  // Guard for this location; a handover is informal, so there is no shift to start or end.
  const handleStartDuty = async () => {
    setLoading(true);
    setError('');
    try {
      await startShiftLogin({
        guardId: GENERAL_GUARD_ID,
        pin: null,
        shiftLabel: 'On Duty',
      });
      navigate('/');
    } catch (err) {
      if (err.code === 'ADMIN_PIN_NOT_SET') {
        navigate('/setup/kiosk-pin', { replace: false, state: { initialSetup: true } });
        return;
      }
      setError(err.response?.data?.error || err.message || 'Unable to start');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-inner">
        <div className="login-brand">
          <img className="login-brand-logo" src={NIGHTGUARD_LOGO} alt="Night-Guard Security" />
          <h1 className="login-brand-title">{locationName}</h1>
          <p className="login-brand-copy">NightGuard shared-device access for patrol and logging.</p>
        </div>

        {error && <div className="status-banner error">{error}</div>}

        {mode === 'select' && (
          <div className="login-stack">
            <div className="status-banner neutral">
              Activity on this device is recorded as {GENERAL_GUARD.full_name} for this location.
            </div>
            <button className="button-submit primary" onClick={handleStartDuty} disabled={loading}>
              {loading ? 'Starting...' : 'Start Guard Duty'}
            </button>
            <button className="button-submit" onClick={() => { setMode('admin'); setError(''); }} disabled={loading}>
              Admin Login
            </button>
          </div>
        )}

        {mode === 'admin' && (
          <form onSubmit={handleAdminLogin} className="login-stack">
            <div className="login-section-title">Admin Sign In</div>
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
            <button className="button-text" type="button" onClick={() => { setMode('select'); setError(''); setPassword(''); }}>
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
