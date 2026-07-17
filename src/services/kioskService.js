import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const KIOSK_STATE_KEY = 'kiosk_session_state';
const KIOSK_ACTIVE_KEY = 'nightguard_kiosk_active';
const END_SHIFT_SECURITY_KEY = 'end_shift_security_state';
const KioskPlugin = registerPlugin('KioskPlugin');

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

async function callNative(method) {
  if (!Capacitor.isNativePlatform?.() || !KioskPlugin?.[method]) return false;
  await KioskPlugin[method]();
  return true;
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
  async startSession(shiftId) {
    let lockTaskMode = 'unavailable';
    let kioskModeStarted = false;
    let foregroundServiceStarted = false;

    try {
      console.info('[KioskService] entering kiosk mode');
      // NightGuard fix: retry kiosk activation once and surface persistent failures to the UI.
      kioskModeStarted = await callNativeWithRetry('startKioskMode', 'entering kiosk');
      const lockState = await this.getLockState();
      lockTaskMode = kioskModeStarted
        ? (lockState === 'unavailable' ? 'screen_pinning' : lockState)
        : 'unavailable';
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

  // Re-assert kiosk mode if the session is active but the device is no longer locked
  // (Android can drop screen-pinning after a task switch, notification, or app kill/restart).
  async ensureActive() {
    const state = await this.getSessionState();
    if (!state?.active || !this.isNativeAvailable()) return state;

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
