import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { getDeviceSettings } from '../lib/deviceStore';

const KIOSK_STATE_KEY = 'kiosk_session_state';
const KIOSK_ACTIVE_KEY = 'nightguard_kiosk_active';
const KIOSK_SUSPEND_KEY = 'nightguard_kiosk_suspended_until';
const END_SHIFT_SECURITY_KEY = 'end_shift_security_state';
const KioskPlugin = registerPlugin('KioskPlugin');

// How long the lock stays off after the guard asks to open another app. Long enough
// for Android to actually switch tasks on a slow handset, short enough that a device
// left on the WhatsApp screen re-locks itself instead of staying open all night.
const EXTERNAL_APP_GRACE_MS = 3 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prefSet(key, value) {
  const next = typeof value === 'string' ? value : JSON.stringify(value);
  localStorage.setItem(key, next);
  try {
    await Preferences.set({ key, value: next });
  } catch (err) {
    console.warn('[KioskService] Preferences write failed:', err?.message || err);
  }
}

async function prefGetJson(key, fallback) {
  try {
    const { value } = await Preferences.get({ key });
    const raw = value ?? localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
}

async function callNativeWithRetry(method, transitionLabel) {
  if (!Capacitor.isNativePlatform?.() || !KioskPlugin?.[method]) {
    console.info(`[KioskService] ${transitionLabel}: ${method} unavailable on this platform`);
    return false;
  }

  try {
    console.info(`[KioskService] ${transitionLabel}: ${method} attempt 1`);
    await KioskPlugin[method]();
    return true;
  } catch (firstErr) {
    console.warn(`[KioskService] ${transitionLabel}: ${method} attempt 1 failed:`, firstErr?.message || firstErr);
    await sleep(500);
    try {
      console.info(`[KioskService] ${transitionLabel}: ${method} retry after 500ms`);
      await KioskPlugin[method]();
      return true;
    } catch (secondErr) {
      console.error(`[KioskService] ${transitionLabel}: ${method} retry failed:`, secondErr?.message || secondErr);
      throw new Error(secondErr?.message || firstErr?.message || `${method} failed`);
    }
  }
}

const KioskService = {
  /**
   * Admin switch: does going on duty lock this handset to NightGuard?
   *
   * Only the LOCK is optional. The shift, the foreground service and the patrol alarm all
   * behave identically either way — turning this off buys the guard access to other apps
   * (WhatsApp, camera, dialler), nothing else.
   */
  isEnabled() {
    return getDeviceSettings().kioskModeEnabled !== false;
  },

  async startSession(shiftId) {
    let lockTaskMode = 'unavailable';
    let kioskModeStarted = false;
    let foregroundServiceStarted = false;
    const lockWanted = this.isEnabled();

    // A new shift starts locked, whatever the last one left behind. Without this, a
    // grace window opened seconds before a handover would keep the next guard unlocked.
    this.clearSuspension();

    try {
      if (!lockWanted) {
        console.info('[KioskService] kiosk mode disabled for this device — starting shift unlocked');
        lockTaskMode = 'disabled';
      } else {
        console.info('[KioskService] entering kiosk mode');
        // NightGuard fix: retry kiosk activation once and surface persistent failures to the UI.
        kioskModeStarted = await callNativeWithRetry('startKioskMode', 'entering kiosk');
        const lockState = await this.getLockState();
        lockTaskMode = kioskModeStarted
          ? (lockState === 'unavailable' ? 'screen_pinning' : lockState)
          : 'unavailable';
      }
    } catch (err) {
      localStorage.setItem(KIOSK_ACTIVE_KEY, 'false');
      console.error('[KioskService] entering kiosk failed:', err?.message || err);
      throw err;
    }

    try {
      console.info('[KioskService] starting kiosk foreground service');
      // NightGuard fix: native kiosk plugin calls retry once instead of failing intermittently.
      foregroundServiceStarted = await callNativeWithRetry('startForegroundService', 'starting kiosk foreground service');
    } catch (err) {
      localStorage.setItem(KIOSK_ACTIVE_KEY, 'false');
      console.error('[KioskService] start foreground service failed:', err?.message || err);
      throw err;
    }

    const state = {
      active: true,
      shiftId,
      startedAt: new Date().toISOString(),
      kioskModeStarted,
      foregroundServiceStarted,
      lockTaskMode,
      locked: lockTaskMode === 'locked' || lockTaskMode === 'pinned',
      lastHeartbeatAt: new Date().toISOString(),
    };
    await prefSet(KIOSK_STATE_KEY, state);
    localStorage.setItem(KIOSK_ACTIVE_KEY, 'true');
    console.info('[KioskService] kiosk mode active, lock state:', lockTaskMode);
    return state;
  },

  async stopSession() {
    const errors = [];
    console.info('[KioskService] exiting kiosk mode');
    this.clearSuspension();
    try {
      // NightGuard fix: retry kiosk deactivation once and report failure to the end-shift UI.
      await callNativeWithRetry('stopForegroundService', 'exiting kiosk foreground service');
    } catch (err) {
      errors.push(err);
      console.warn('[KioskService] stop foreground service failed:', err?.message || err);
    }

    try {
      await callNativeWithRetry('stopKioskMode', 'exiting kiosk');
    } catch (err) {
      errors.push(err);
      console.warn('[KioskService] stop kiosk failed:', err?.message || err);
    }

    const previous = await this.getSessionState();
    const state = {
      ...(previous || {}),
      active: false,
      endedAt: new Date().toISOString(),
      kioskModeStarted: false,
      foregroundServiceStarted: false,
      lockTaskMode: 'unavailable',
      lastHeartbeatAt: new Date().toISOString(),
    };
    await prefSet(KIOSK_STATE_KEY, state);
    localStorage.setItem(KIOSK_ACTIVE_KEY, 'false');
    console.info('[KioskService] kiosk mode inactive');
    if (errors.length) {
      throw new Error(errors.map((err) => err?.message || String(err)).join('; '));
    }
    return state;
  },

  async restoreActiveSession() {
    const shouldRestore = localStorage.getItem(KIOSK_ACTIVE_KEY) === 'true';
    if (!shouldRestore) return null;

    const state = await this.getSessionState();
    if (!state?.active) {
      localStorage.setItem(KIOSK_ACTIVE_KEY, 'false');
      return state;
    }

    // A shift restored after an app kill must not re-lock a device the admin has since
    // unlocked. The foreground service still comes back — only the lock is conditional.
    if (!this.isEnabled()) {
      console.info('[KioskService] kiosk disabled for this device — restoring shift unlocked');
      const foregroundOnly = await callNativeWithRetry('startForegroundService', 'restoring foreground service').catch(() => false);
      const unlocked = {
        ...state,
        kioskModeStarted: false,
        foregroundServiceStarted: foregroundOnly,
        lockTaskMode: 'disabled',
        locked: false,
        lastHeartbeatAt: new Date().toISOString(),
      };
      await prefSet(KIOSK_STATE_KEY, unlocked);
      localStorage.setItem(KIOSK_ACTIVE_KEY, 'true');
      return unlocked;
    }

    console.info('[KioskService] re-applying kiosk mode after app boot');
    // NightGuard fix: re-apply persisted kiosk state after Android kills/restarts the app.
    const kioskModeStarted = await callNativeWithRetry('startKioskMode', 'restoring kiosk');
    const foregroundServiceStarted = await callNativeWithRetry('startForegroundService', 'restoring kiosk foreground service');
    const lockState = await this.getLockState();
    const next = {
      ...state,
      kioskModeStarted,
      foregroundServiceStarted,
      lockTaskMode: kioskModeStarted
        ? (lockState === 'unavailable' ? state.lockTaskMode || 'screen_pinning' : lockState)
        : state.lockTaskMode || 'unavailable',
      locked: lockState === 'locked' || lockState === 'pinned',
      lastHeartbeatAt: new Date().toISOString(),
    };
    await prefSet(KIOSK_STATE_KEY, next);
    localStorage.setItem(KIOSK_ACTIVE_KEY, 'true');
    console.info('[KioskService] kiosk restored, lock state:', next.lockTaskMode);
    return next;
  },

  // Whether the native kiosk plugin is present on this platform.
  isNativeAvailable() {
    return Boolean(Capacitor.isNativePlatform?.() && KioskPlugin?.startKioskMode);
  },

  // Current OS lock-task state: 'locked' | 'pinned' | 'none' | 'unavailable'.
  async getLockState() {
    if (!Capacitor.isNativePlatform?.() || !KioskPlugin?.getLockState) return 'unavailable';
    try {
      const res = await KioskPlugin.getLockState();
      return res?.lockState || 'none';
    } catch (err) {
      console.warn('[KioskService] getLockState failed:', err?.message || err);
      return 'unavailable';
    }
  },

  // ---------------------------------------------------------------------------
  //  Letting the guard out to another app, on purpose
  // ---------------------------------------------------------------------------
  //
  //  Lock task mode blocks starting any other activity, so tapping WhatsApp on a
  //  kiosked handset did nothing at all: the screen said "Opening WhatsApp", the
  //  navigation was swallowed by the lock, and the guard was left staring at a page
  //  with a button that also did nothing. Worse, the 20-second watchdog below would
  //  have re-pinned the device the moment it did work.
  //
  //  So a trip out is an explicit, time-boxed SUSPENSION rather than an exit: the
  //  lock comes off, the watchdog is told to leave it off, and the shift, the
  //  foreground service and the departure log all carry on exactly as before. The
  //  guard is still on duty and still accountable — they are just allowed out.

  isSuspended() {
    const until = Number(localStorage.getItem(KIOSK_SUSPEND_KEY) || 0);
    return Number.isFinite(until) && until > Date.now();
  },

  clearSuspension() {
    try {
      localStorage.removeItem(KIOSK_SUSPEND_KEY);
    } catch { /* best effort */ }
  },

  /**
   * Release the lock so another app can be launched. Safe to call when kiosk is off
   * or unsupported — it just marks the grace window and returns.
   *
   * The marker is written BEFORE the unlock, not after: `ensureActive` runs on a
   * timer and on every resume, and either could otherwise re-pin the device in the
   * gap between releasing the lock and Android switching tasks.
   */
  async suspendForExternalApp(label = 'another app') {
    try {
      localStorage.setItem(KIOSK_SUSPEND_KEY, String(Date.now() + EXTERNAL_APP_GRACE_MS));
    } catch { /* best effort — the unlock below still runs */ }

    if (!this.isNativeAvailable()) return { released: false, reason: 'unsupported' };

    const lockState = await this.getLockState();
    if (lockState !== 'locked' && lockState !== 'pinned') {
      return { released: false, reason: 'not_locked' };
    }

    console.info(`[KioskService] releasing lock to open ${label}`);
    try {
      await callNativeWithRetry('stopKioskMode', `releasing kiosk for ${label}`);
      return { released: true };
    } catch (err) {
      console.warn('[KioskService] could not release lock:', err?.message || err);
      return { released: false, reason: 'failed', error: err?.message || String(err) };
    }
  },

  /**
   * Called when the app comes back to the foreground. Ends any grace window and puts
   * the lock back — the guard's trip out is over the moment they return.
   */
  async resumeFromExternalApp() {
    this.clearSuspension();
    return this.ensureActive();
  },

  // Re-assert kiosk mode if the session is active but the device is no longer locked
  // (Android can drop screen-pinning after a task switch, notification, or app kill/restart).
  async ensureActive() {
    const state = await this.getSessionState();
    if (!state?.active || !this.isNativeAvailable()) return state;

    // Deliberately unlocked for a trip to another app — leave it alone until the grace
    // window expires or the guard comes back.
    if (this.isSuspended()) return state;

    // The watchdog is what makes kiosk mode stick, so it is also what makes turning kiosk
    // OFF stick: with the lock disabled it releases any lock still held instead of
    // re-applying one, and a guard who unpins by hand is left alone.
    if (!this.isEnabled()) {
      const held = await this.getLockState();
      if (held === 'locked' || held === 'pinned') {
        console.info('[KioskService] kiosk disabled — releasing lock');
        await callNativeWithRetry('stopKioskMode', 'releasing kiosk').catch((err) => {
          console.warn('[KioskService] release kiosk failed:', err?.message || err);
        });
      }
      const unlocked = {
        ...state,
        kioskModeStarted: false,
        lockTaskMode: 'disabled',
        locked: false,
        lastHeartbeatAt: new Date().toISOString(),
      };
      await prefSet(KIOSK_STATE_KEY, unlocked);
      return unlocked;
    }

    let lockState = await this.getLockState();
    if (lockState === 'none') {
      console.info('[KioskService] lock dropped — re-applying kiosk mode');
      await callNativeWithRetry('startKioskMode', 're-applying kiosk').catch((err) => {
        console.warn('[KioskService] re-apply kiosk failed:', err?.message || err);
      });
      await callNativeWithRetry('startForegroundService', 're-applying kiosk foreground service').catch((err) => {
        console.warn('[KioskService] re-apply foreground failed:', err?.message || err);
      });
      lockState = await this.getLockState();
    }

    const next = {
      ...state,
      lockTaskMode: lockState === 'unavailable' ? state.lockTaskMode || 'unavailable' : lockState,
      locked: lockState === 'locked' || lockState === 'pinned',
      lastHeartbeatAt: new Date().toISOString(),
    };
    await prefSet(KIOSK_STATE_KEY, next);
    return next;
  },

  // Snapshot for status UI. Combines persisted session with the live OS lock state.
  async getStatus() {
    const state = await this.getSessionState();
    const supported = this.isNativeAvailable();
    const lockState = supported ? await this.getLockState() : 'unavailable';
    return {
      active: Boolean(state?.active),
      supported,
      lockState,
      locked: lockState === 'locked' || lockState === 'pinned',
      startedAt: state?.startedAt || null,
    };
  },

  async heartbeat() {
    const state = await this.getSessionState();
    if (!state?.active) return state;
    const next = { ...state, lastHeartbeatAt: new Date().toISOString() };
    await prefSet(KIOSK_STATE_KEY, next);
    return next;
  },

  getSessionState() {
    return prefGetJson(KIOSK_STATE_KEY, null);
  },

  getEndShiftSecurityState() {
    return prefGetJson(END_SHIFT_SECURITY_KEY, {
      failedAttempts: 0,
      lockedUntil: null,
      lastFailedAttemptAt: null,
    });
  },

  async saveEndShiftSecurityState(state) {
    await prefSet(END_SHIFT_SECURITY_KEY, {
      failedAttempts: Number(state?.failedAttempts || 0),
      lockedUntil: state?.lockedUntil || null,
      lastFailedAttemptAt: state?.lastFailedAttemptAt || null,
    });
  },
};

export default KioskService;
