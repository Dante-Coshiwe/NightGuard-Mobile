import React, { createContext, useState, useContext, useEffect } from 'react';
import {
  getCurrentUser as getCurrentUserRequest,
  getMySite,
  login as apiLogin,
} from '../services/api';
import { supabase } from '../lib/supabase';
import { enqueueOfflineItem, syncOfflineQueueNow } from '../hooks/useOfflineQueue';
import {
  loadDeviceConfiguration,
  loadPatrolConfiguration,
  loadReportSchedules,
  loadSiteLookupData,
  syncPendingSchemaData,
} from '../services/schemaData';
import {
  clearShiftSession,
  getCachedGuards,
  getCachedSiteSettings,
  getPatrolConfig,
  getQuickSwitchEnabled,
  getShiftSession,
  saveCachedGuards,
  saveCachedSiteSettings,
  saveQuickSwitchEnabled,
  saveShiftSession,
  updateCachedGuard,
  GENERAL_GUARD,
  GENERAL_GUARD_ID,
  isGeneralGuardId,
} from '../lib/deviceStore';
import { confirmAppOnline, isAppOnline, NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { clearAdminDeviceBinding, getAdminDeviceBinding, saveAdminDeviceBinding } from '../lib/deviceBinding';
import NotificationService from '../services/notificationService';
import KioskService from '../services/kioskService';
import { hasAdminPinHash } from '../services/kioskPinService';

const AuthContext = createContext();

const CACHED_USER_KEY = 'nightguard_cached_user';
const BOUND_USER_KEY = 'nightguard_bound_user';
const DEVICE_BOUND_KEY = 'nightguard_device_bound';
const SITE_ID = import.meta.env.VITE_SITE_ID;

function normaliseGuard(guard) {
  if (isGeneralGuardId(guard?.id) || guard?._is_general_guard) {
    return { ...GENERAL_GUARD };
  }
  return {
    ...guard,
    id: guard.id,
    full_name: guard.full_name || guard.name || 'Unnamed Guard',
    name: guard.name || guard.full_name || 'Unnamed Guard',
    pin: String(guard.pin || guard.guard_pin || '1234'),
    guard_pin: String(guard.guard_pin || guard.pin || '1234'),
    is_active: guard.is_active !== false,
    user_type: guard.user_type || 'guard',
    role: guard.role || guard.user_type || 'guard',
  };
}

function mergeGuards(serverGuards, cachedGuards) {
  return [normaliseGuard(GENERAL_GUARD)];
}

function getShiftType(label) {
  const value = String(label || '').toLowerCase();
  if (value.includes('night')) return 'night';
  if (value.includes('day')) return 'day';
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6 ? 'night' : 'day';
}

function getCanonicalShiftLabel(label) {
  return getShiftType(label) === 'night' ? 'Night Shift' : 'Day Shift';
}

function createLocalId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isNetworkFailure(err) {
  const message = String(err?.message || '').toLowerCase();
  if (!err?.response) return true;
  return (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    err.code === 'ECONNABORTED'
  );
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [guards, setGuards] = useState(getCachedGuards());
  const [siteSettings, setSiteSettings] = useState(getCachedSiteSettings());
  const [shiftSession, setShiftSession] = useState(getShiftSession());
  const [quickSwitchEnabled, setQuickSwitchEnabledState] = useState(getQuickSwitchEnabled());
  const [loading, setLoading] = useState(true);

  const cacheUser = (userData) => {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
    setUser(userData);
  };

  const cacheBoundUser = (userData) => {
    localStorage.setItem(BOUND_USER_KEY, JSON.stringify(userData));
    return userData;
  };

  const getBoundUser = () => {
    try {
      const raw = localStorage.getItem(BOUND_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const commitGuards = (nextGuards) => {
    const normalised = saveCachedGuards((nextGuards || []).map(normaliseGuard));
    setGuards(normalised);
    return normalised;
  };

  const commitSiteSettings = (nextSite) => {
    const cached = saveCachedSiteSettings(nextSite || {});
    setSiteSettings(cached);
    return cached;
  };

  const setQuickSwitchEnabled = (value) => {
    const next = saveQuickSwitchEnabled(value);
    setQuickSwitchEnabledState(next);
    return next;
  };

  const loadGuards = async () => {
    return commitGuards([GENERAL_GUARD]);
  };

  const refreshSiteSettings = async () => {
    if (!isAppOnline()) {
      const cached = getCachedSiteSettings();
      setSiteSettings(cached);
      return cached;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const cached = getCachedSiteSettings();
        setSiteSettings(cached);
        return cached;
      }

      const data = await getMySite();
      return commitSiteSettings(data);
    } catch {
      const cached = getCachedSiteSettings();
      setSiteSettings(cached);
      return cached;
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      const isDeviceBound = localStorage.getItem(DEVICE_BOUND_KEY) === 'true';
      const cachedUser = localStorage.getItem(CACHED_USER_KEY);
      const cachedShift = getShiftSession();
      const adminBinding = await getAdminDeviceBinding();

      if (cachedShift) setShiftSession(cachedShift);

      if ((isDeviceBound || adminBinding?.admin_email) && cachedUser) {
        setUser(JSON.parse(cachedUser));
      } else if (adminBinding?.admin_email) {
        setUser({
          id: adminBinding.admin_id || null,
          email: adminBinding.admin_email,
          organization_id: adminBinding.org_id || null,
          site_id: adminBinding.site_id || SITE_ID || null,
          full_name: adminBinding.admin_email,
          name: adminBinding.admin_email,
          user_type: 'admin',
          role: 'admin',
          _boundOnly: true,
        });
      } else if (!isDeviceBound) {
        if (isAppOnline()) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              if (cachedUser) {
                setUser(JSON.parse(cachedUser));
              } else {
                const profile = await getCurrentUserRequest().then((res) => res.data);
                if (profile) cacheUser(profile);
              }
            } else if (cachedUser) {
              setUser(JSON.parse(cachedUser));
            }
          } catch {
            if (cachedUser) setUser(JSON.parse(cachedUser));
          }
        } else if (cachedUser) {
          setUser(JSON.parse(cachedUser));
        }
      }

      await Promise.all([loadGuards(), refreshSiteSettings()]);
      await Promise.allSettled([
        loadSiteLookupData(getCachedSiteSettings()),
        loadPatrolConfiguration(getCachedSiteSettings()),
        loadDeviceConfiguration(getCachedSiteSettings()),
        loadReportSchedules(getCachedSiteSettings()),
      ]);
      // NightGuard fix: restore persisted kiosk mode after app boot without touching keyboard/inset code.
      await KioskService.restoreActiveSession().catch((err) => {
        console.error('[Auth] Kiosk restore failed:', err?.message || err);
      });
      setLoading(false);
    };

    bootstrap();
  }, []);

  useEffect(() => {
    const refreshCaches = async () => {
      const latestSite = await refreshSiteSettings();
      loadGuards();
      await Promise.allSettled([
        loadSiteLookupData(latestSite),
        loadPatrolConfiguration(latestSite),
        loadDeviceConfiguration(latestSite),
        loadReportSchedules(latestSite),
      ]);
    };

    const syncPending = async () => {
      const latestSite = await refreshSiteSettings();
      await syncPendingSchemaData(latestSite);
      await refreshCaches();
    };

    window.addEventListener('online', syncPending);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, syncPending);
    window.addEventListener('nightguard_sync_complete', refreshCaches);
    return () => {
      window.removeEventListener('online', syncPending);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, syncPending);
      window.removeEventListener('nightguard_sync_complete', refreshCaches);
    };
  }, [guards.length]);

  useEffect(() => {
    const syncQuickSwitch = () => setQuickSwitchEnabledState(getQuickSwitchEnabled());
    window.addEventListener('nightguard_device_settings_updated', syncQuickSwitch);
    return () => window.removeEventListener('nightguard_device_settings_updated', syncQuickSwitch);
  }, []);

  const loginOffline = async () => {
    const isDeviceBound = localStorage.getItem(DEVICE_BOUND_KEY) === 'true';
    const adminBinding = await getAdminDeviceBinding();
    if (!isDeviceBound && !adminBinding?.admin_email) {
      throw new Error('Device is not bound. Connect online and complete admin login first.');
    }

    const cachedUser = localStorage.getItem(CACHED_USER_KEY);
    if (cachedUser) {
      const userData = JSON.parse(cachedUser);
      setUser(userData);
      return userData;
    }

    const boundUser = getBoundUser();
    if (!boundUser) {
      throw new Error('No offline bound account found. Go online once to refresh account data.');
    }

    cacheUser(boundUser);
    return boundUser;
  };

  const login = async (email, password) => {
    if (!String(email || '').trim() || !String(password || '').trim()) {
      return loginOffline();
    }

    let response;
    try {
      response = await apiLogin({ email, password });
    } catch (err) {
      if (isNetworkFailure(err)) {
        return loginOffline();
      }
      throw err;
    }

    const { user: userData } = response.data;
    confirmAppOnline('admin-login-success');
    localStorage.setItem(DEVICE_BOUND_KEY, 'true');
    localStorage.setItem('nightguard_bound_email', email);

    cacheUser(userData);
    cacheBoundUser(userData);
    await saveAdminDeviceBinding(userData, email);
    await Promise.all([loadGuards(), refreshSiteSettings()]);
    await syncOfflineQueueNow();
    await syncPendingSchemaData(getCachedSiteSettings());
    return userData;
  };

  const startShiftLogin = async ({ guardId, pin, shiftLabel, createShift = true } = {}) => {
    const canonicalShift = getCanonicalShiftLabel(shiftLabel);
    const shiftType = getShiftType(shiftLabel);
    const guardUser = normaliseGuard(GENERAL_GUARD);

    if (createShift && !(await hasAdminPinHash())) {
      const err = new Error('Kiosk exit PIN not set. Please configure the exit PIN in admin settings before starting a shift.');
      err.code = 'ADMIN_PIN_NOT_SET';
      throw err;
    }

    commitGuards([guardUser]);

    const siteId = getCachedSiteSettings().id || SITE_ID || null;
    const shiftId = createShift ? createLocalId('shift') : (shiftSession?.id || getShiftSession()?.id || null);
    const startedAt = new Date().toISOString();
    const session = {
      id: shiftId,
      shiftLabel: canonicalShift,
      shiftType,
      startedAt,
      activeGuardId: guardUser?.id || null,
      activeGuardName: guardUser.full_name,
      siteId,
      status: 'active',
    };

    saveShiftSession(session);
    setShiftSession(session);

    if (guardUser) {
      cacheUser(guardUser);
      updateCachedGuard(guardUser.id, guardUser);
      setGuards(getCachedGuards());
    }

    if (createShift) {
      const shiftPayload = {
        id: shiftId,
        site_id: siteId,
        guard_id: null,
        local_guard_id: guardUser?.id || null,
        shift_name: canonicalShift,
        shift_type: shiftType,
        started_at: startedAt,
        status: 'active',
      };

      enqueueOfflineItem('post', '/shifts/start', shiftPayload, shiftId);
      console.info('[Auth] Created local shift and queued sync:', shiftPayload);
    }

    if (createShift) {
      await KioskService.startSession(shiftId);
      const patrolConfig = getPatrolConfig();
      if (patrolConfig.patrolScheduleEnabled !== false) {
        await NotificationService.scheduleAllDailyPatrols(patrolConfig.patrolTimes || []);
      }
      await NotificationService.addToAppNotificationFeed({
        type: 'shift',
        title: 'Shift started',
        body: `${canonicalShift} started locally on this device.`,
        metadata: { shiftId, guardId: guardUser?.id || null },
      });
    }

    if (isAppOnline()) {
      await syncOfflineQueueNow();
      await syncPendingSchemaData(getCachedSiteSettings());
    }

    return { ...guardUser, shift: session, shiftLabel: canonicalShift, shiftType };
  };

  const switchGuard = async (guardId, pin) => {
    const nextGuard = normaliseGuard(GENERAL_GUARD);

    const updatedSession = {
      ...(getShiftSession() || shiftSession || {}),
      activeGuardId: GENERAL_GUARD_ID,
      activeGuardName: GENERAL_GUARD.full_name,
      switchedAt: new Date().toISOString(),
    };

    saveShiftSession(updatedSession);
    setShiftSession(updatedSession);
    return nextGuard;
  };

  const unbindDevice = async (password) => {
    const binding = await getAdminDeviceBinding();
    const boundEmail = localStorage.getItem('nightguard_bound_email') || binding?.admin_email;
    if (!boundEmail) throw new Error('No bound email found');

    const { error } = await supabase.auth.signInWithPassword({ email: boundEmail, password });
    if (error) throw new Error('Password incorrect - device not unbound');

    localStorage.removeItem(DEVICE_BOUND_KEY);
    localStorage.removeItem(CACHED_USER_KEY);
    localStorage.removeItem(BOUND_USER_KEY);
    localStorage.removeItem('nightguard_bound_email');
    await clearAdminDeviceBinding();
    clearShiftSession();
    setShiftSession(null);
    setUser(null);
    await supabase.auth.signOut().catch(() => null);
  };

  const logout = async () => {
    // Keep Supabase device session alive for background sync while enforcing app logout.
    localStorage.removeItem(CACHED_USER_KEY);
    clearShiftSession();
    setShiftSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        guards,
        siteSettings,
        loading,
        login,
        logout,
        unbindDevice,
        loadGuards,
        refreshSiteSettings,
        startShiftLogin,
        switchGuard,
        shiftSession,
        quickSwitchEnabled,
        setQuickSwitchEnabled,
        setCachedGuards: commitGuards,
        setCachedSiteSettings: commitSiteSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
