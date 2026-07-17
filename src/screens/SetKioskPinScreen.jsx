import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Keyboard } from '@capacitor/keyboard';
import { useAuth } from '../contexts/AuthContext';
import { GENERAL_GUARD_ID } from '../lib/deviceStore';
import { saveAdminPin } from '../services/kioskPinService';
import './screens.css';

function validatePin(pin, confirmPin) {
  if (pin.length < 4) return 'PIN must be at least 4 digits';
  if (pin === '0000') return 'This PIN is reserved for the General Guard. Choose a different PIN.';
  if (confirmPin && pin !== confirmPin) return 'PINs do not match';
  return '';
}

export default function SetKioskPinScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { startShiftLogin, quickSwitchEnabled } = useAuth();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const pinRef = useRef(null);
  const confirmRef = useRef(null);
  const initialSetup = Boolean(location.state?.initialSetup);

  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidHide', () => window.scrollTo(0, 0));
    return () => listener.then((handler) => handler.remove()).catch(() => null);
  }, []);

  const handlePinFocus = (ref) => {
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

  const cleanPin = (value) => value.replace(/\D/g, '').slice(0, 6);
  const validationError = validatePin(pin, confirmPin);
  const canSave = pin.length >= 4 && confirmPin.length >= 4 && !validationError;

  const handleSave = async (event) => {
    event.preventDefault();
    const nextError = validatePin(pin, confirmPin);
    if (nextError) {
      setError(nextError);
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await saveAdminPin(pin);
      setSuccess('Kiosk exit PIN saved.');

      if (initialSetup && !quickSwitchEnabled) {
        await startShiftLogin({
          guardId: GENERAL_GUARD_ID,
          pin: '0000',
          shiftLabel: 'Day Shift',
        });
        navigate('/', { replace: true });
        return;
      }

      window.setTimeout(() => {
        if (initialSetup) {
          navigate('/', { replace: true });
        } else {
          navigate(-1);
        }
      }, 500);
    } catch (err) {
      setError(err?.message || 'Unable to save PIN');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-container kiosk-pin-screen">
      <form onSubmit={handleSave} className="kiosk-pin-card">
        <h1 className="form-title">Set Kiosk Exit PIN</h1>
        <p style={{ margin: '6px 0 18px', color: '#a3a3a3', lineHeight: 1.45 }}>
          This PIN will be required to end a guard&apos;s shift and unlock the device.
        </p>

        <div className="form-group">
          <label className="form-label required">New PIN</label>
          <input
            ref={pinRef}
            className="form-input kiosk-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onFocus={() => handlePinFocus(pinRef)}
            onChange={(event) => {
              setPin(cleanPin(event.target.value));
              setError('');
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label required">Confirm PIN</label>
          <input
            ref={confirmRef}
            className="form-input kiosk-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={confirmPin}
            onFocus={() => handlePinFocus(confirmRef)}
            onChange={(event) => {
              setConfirmPin(cleanPin(event.target.value));
              setError('');
            }}
          />
        </div>

        {(error || (confirmPin && validationError)) && (
          <div className="status-banner error">{error || validationError}</div>
        )}
        {success && <div className="status-banner neutral" style={{ color: '#86efac', borderColor: '#166534' }}>{success}</div>}

        <button className="button-submit primary" type="submit" disabled={!canSave || saving}>
          {saving ? 'Saving...' : 'Save PIN'}
        </button>
      </form>
    </div>
  );
}
