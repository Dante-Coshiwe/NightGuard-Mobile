import React, { useEffect, useRef, useState } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { enqueueOfflineItem } from '../hooks/useOfflineQueue';
import NotificationService, { hashPin } from '../services/notificationService';
import KioskService from '../services/kioskService';
import { clearShiftSession, getShiftSession } from '../lib/deviceStore';
import { getStoredAdminPinHashValue } from '../services/kioskPinService';

// Universal fallback PIN so a manager who forgets the device PIN can always exit kiosk mode.
const UNIVERSAL_EXIT_PIN = '773745';

export default function EndShiftModal({ activeShift, onClose, onEnded }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { post } = useOfflineApi();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidHide', () => window.scrollTo(0, 0));
    return () => listener.then((handler) => handler.remove()).catch(() => null);
  }, []);

  const handlePinFocus = () => {
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const isUniversal = pin === UNIVERSAL_EXIT_PIN;

      // The universal PIN always works (managers' fallback) and bypasses the lockout.
      if (!isUniversal) {
        const security = await KioskService.getEndShiftSecurityState();
        if (security.lockedUntil && new Date(security.lockedUntil) > new Date()) {
          setError(`Exit is locked until ${new Date(security.lockedUntil).toLocaleTimeString()}.`);
          return;
        }

        const storedHash = await getStoredAdminPinHashValue();
        const enteredHash = await hashPin(pin);
        if (!storedHash || enteredHash !== storedHash) {
          const failedAttempts = Number(security.failedAttempts || 0) + 1;
          const lockedUntil = failedAttempts >= 3 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
          await KioskService.saveEndShiftSecurityState({
            failedAttempts,
            lockedUntil,
            lastFailedAttemptAt: new Date().toISOString(),
          });

          const title = failedAttempts >= 3 ? 'Multiple failed exit attempts' : 'Failed kiosk exit attempt';
          const body = failedAttempts >= 3
            ? 'Multiple failed exit attempts - possible security incident.'
            : `Failed kiosk exit attempt at ${new Date().toLocaleString()}.`;
          await NotificationService.addToAppNotificationFeed({
            type: 'system',
            title,
            body,
            metadata: { failedAttempts, shiftId: activeShift?.id || getShiftSession()?.id || null },
          });
          enqueueOfflineItem('post', '/security-events', {
            type: failedAttempts >= 3 ? 'multiple_failed_exit_attempts' : 'failed_exit_attempt',
            severity: failedAttempts >= 3 ? 'high' : 'medium',
            shift_id: activeShift?.id || getShiftSession()?.id || null,
            occurred_at: new Date().toISOString(),
            metadata: { failedAttempts },
          }, `security_event_${Date.now()}`);
          setError(failedAttempts >= 3 ? 'Incorrect PIN. Exit is locked for 5 minutes.' : 'Incorrect PIN. Contact your supervisor.');
          return;
        }
      }

      // PIN accepted (admin or universal) — exit kiosk.
      const shiftId = activeShift?.id || getShiftSession()?.id || null;
      const endedAt = new Date().toISOString();
      await KioskService.saveEndShiftSecurityState({ failedAttempts: 0, lockedUntil: null, lastFailedAttemptAt: null });
      await NotificationService.cancelAllPatrolNotifications();
      await NotificationService.addToAppNotificationFeed({
        type: 'shift',
        title: 'Kiosk exited',
        body: isUniversal ? 'Device unlocked with the universal PIN.' : 'Device unlocked after admin PIN verification.',
        metadata: { shiftId },
      });

      await post('/shifts/end', {
        shift_id: shiftId,
        ended_at: endedAt,
        status: 'ended',
        end_reason: isUniversal ? 'universal_pin' : 'admin_pin_verified',
      }, {
        clientTempId: `shift_end_${Date.now()}`,
        offlineResponse: { shift_id: shiftId, ended_at: endedAt, status: 'ended', _offline: true },
        forceQueue: true,
      });

      // Un-pin must never block the exit — a native failure still returns the guard to login.
      try {
        await KioskService.stopSession();
      } catch (stopErr) {
        console.warn('[ExitKiosk] stopSession failed, continuing exit:', stopErr?.message || stopErr);
      }
      clearShiftSession();
      onEnded?.();
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err?.message || 'Unable to exit kiosk');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" style={styles.backdrop}>
      <form onSubmit={handleSubmit} style={styles.modal}>
        <h2 style={styles.title}>Exit Kiosk</h2>
        <p style={styles.copy}>Enter the admin PIN to unlock and exit the device for handover.</p>
        <input
          ref={inputRef}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="Admin PIN"
          style={styles.input}
          onFocus={handlePinFocus}
          autoFocus
        />
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.actions}>
          <button type="button" onClick={onClose} style={styles.secondary} disabled={submitting}>Cancel</button>
          <button type="submit" style={styles.primary} disabled={submitting}>{submitting ? 'Exiting...' : 'Exit Kiosk'}</button>
        </div>
      </form>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 100000,
    background: 'rgba(0,0,0,0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: 'min(92vw, 420px)',
    background: '#0a0a0a',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: 20,
    color: '#fff',
  },
  title: { margin: '0 0 8px', fontSize: 20 },
  copy: { margin: '0 0 16px', color: '#a3a3a3', fontSize: 14, lineHeight: 1.45 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '13px 14px',
    background: '#111',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#fff',
    fontSize: 18,
  },
  error: { color: '#fca5a5', fontSize: 13, marginTop: 10 },
  actions: { display: 'flex', gap: 10, marginTop: 18 },
  secondary: { flex: 1, padding: 12, borderRadius: 8, border: '1px solid #333', background: '#151515', color: '#d4d4d4' },
  primary: { flex: 1, padding: 12, borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 800 },
};
