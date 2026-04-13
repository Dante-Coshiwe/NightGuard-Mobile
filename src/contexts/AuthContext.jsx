import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import api, { login as apiLogin, getCurrentUser, getGuardsBySite, guardLogin as guardLoginRequest } from '../services/api';
import { supabase } from '../lib/supabase';
import { clearShiftSession, getCachedGuards, getQuickSwitchEnabled, getShiftSession, saveCachedGuards, saveShiftSession } from '../lib/deviceStore';

const AuthContext = createContext();
const CACHED_USER_KEY = 'nightguard_cached_user';
const CACHED_CREDS_KEY = 'nightguard_cached_creds';
const SITE_ID = import.meta.env.VITE_SITE_ID;

function normaliseGuard(guard) {
  return {
    ...guard,
    id: guard.id,
    full_name: guard.full_name || guard.name,
    user_type: guard.user_type || 'guard',
    role: guard.role || guard.user_type || 'guard',
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [guards, setGuards] = useState(getCachedGuards());
  const [shiftSession, setShiftSession] = useState(getShiftSession());
  const [quickSwitchEnabled, setQuickSwitchEnabled] = useState(getQuickSwitchEnabled());
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef(null);

  const scheduleTokenRefresh = (expiresIn = 3600) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const refreshIn = Math.max((expiresIn - 300) * 1000, 60000);
    refreshTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase.auth.refreshSession();
        if (data?.session) {
          localStorage.setItem('token', data.session.access_token);
          scheduleTokenRefresh(data.session.expires_in);
        }
      } catch (err) {
        console.error('Token refresh failed:', err);
      }
    }, refreshIn);
  };

  const cacheUser = (userData) => {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
    setUser(userData);
  };

  const loadGuards = async () => {
    if (!SITE_ID) {
      return guards;
    }

    if (!navigator.onLine) {
      const cached = getCachedGuards();
      setGuards(cached);
      return cached;
    }

    try {
      const data = await getGuardsBySite(SITE_ID);
      const normalised = data.map(normaliseGuard);
      saveCachedGuards(normalised);
      setGuards(normalised);
      return normalised;
    } catch (err) {
      const cached = getCachedGuards();
      setGuards(cached);
      return cached;
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      const token = localStorage.getItem('token');
      const cachedUser = localStorage.getItem(CACHED_USER_KEY);
      const cachedShift = getShiftSession();

      if (cachedShift) {
        setShiftSession(cachedShift);
      }

      if (token && navigator.onLine) {
        try {
          const response = await getCurrentUser();
          cacheUser(response.data);
          scheduleTokenRefresh();
        } catch {
          if (cachedUser) {
            setUser(JSON.parse(cachedUser));
          } else {
            localStorage.removeItem('token');
          }
        }
      } else if (cachedUser) {
        setUser(JSON.parse(cachedUser));
      }

      await loadGuards();
      setLoading(false);
    };

    bootstrap();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const login = async (email, password) => {
    if (!navigator.onLine) {
      const cachedUser = localStorage.getItem(CACHED_USER_KEY);
      const cachedCreds = localStorage.getItem(CACHED_CREDS_KEY);
      if (cachedUser && cachedCreds) {
        const creds = JSON.parse(cachedCreds);
        if (creds.email === email && creds.password === password) {
          const userData = JSON.parse(cachedUser);
          setUser(userData);
          return userData;
        }
      }
      throw new Error('No internet connection and no cached credentials');
    }

    const response = await apiLogin({ email, password });
    const { token, user: userData } = response.data;
    localStorage.setItem('token', token);
    localStorage.setItem(CACHED_CREDS_KEY, JSON.stringify({ email, password }));
    cacheUser(userData);
    scheduleTokenRefresh();
    return userData;
  };

  const startShiftLogin = async ({ guardId, pin, shiftLabel }) => {
    let guardUser = null;
    const availableGuards = guards.length ? guards : await loadGuards();
    const selectedGuard = availableGuards.find((guard) => String(guard.id) === String(guardId));

    if (!selectedGuard) {
      throw new Error('Selected guard could not be found');
    }

    if (!navigator.onLine) {
      const cachedPin = selectedGuard.pin || selectedGuard.guard_pin || '1234';
      if (String(cachedPin) !== String(pin)) {
        throw new Error('Invalid PIN for offline shift start');
      }
      guardUser = normaliseGuard(selectedGuard);
    } else {
      const response = await guardLoginRequest({ guard_id: guardId, pin });
      const { token, user: userData } = response.data;
      if (token) {
        localStorage.setItem('token', token);
      }
      guardUser = normaliseGuard(userData || selectedGuard);
    }

    const session = {
      shiftLabel,
      startedAt: new Date().toISOString(),
      activeGuardId: guardUser.id,
      activeGuardName: guardUser.full_name,
      siteId: SITE_ID || null,
    };

    saveShiftSession(session);
    setShiftSession(session);
    cacheUser(guardUser);
    return guardUser;
  };

  const switchGuard = async (guardId, pin) => {
    const nextGuard = await startShiftLogin({
      guardId,
      pin,
      shiftLabel: shiftSession?.shiftLabel || 'Active Shift',
    });

    const updatedSession = {
      ...(getShiftSession() || shiftSession || {}),
      activeGuardId: nextGuard.id,
      activeGuardName: nextGuard.full_name,
      switchedAt: new Date().toISOString(),
    };

    saveShiftSession(updatedSession);
    setShiftSession(updatedSession);
    return nextGuard;
  };

  const logout = async () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);

    try {
      if (navigator.onLine) {
        if (user?.user_type === 'guard') {
          await api.post('/auth/guard-logout');
        } else {
          await api.post('/auth/logout');
        }
      }
    } catch (err) {
      console.error('Logout error:', err);
    }

    localStorage.removeItem('token');
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
        loading,
        login,
        logout,
        loadGuards,
        startShiftLogin,
        switchGuard,
        shiftSession,
        quickSwitchEnabled,
        setQuickSwitchEnabled,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
