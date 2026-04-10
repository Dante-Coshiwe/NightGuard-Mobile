import React, { createContext, useState, useContext, useEffect, useRef } from "react";
import api, { login as apiLogin, getCurrentUser } from "../services/api";
import { supabase } from "../lib/supabase";

const AuthContext = createContext();
const CACHED_USER_KEY = "nightguard_cached_user";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef(null);

  const scheduleTokenRefresh = (expiresIn = 3600) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const refreshIn = Math.max((expiresIn - 300) * 1000, 60000);
    refreshTimer.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (data?.session) {
          localStorage.setItem("token", data.session.access_token);
          scheduleTokenRefresh(data.session.expires_in);
        }
      } catch (err) {
        console.error("Token refresh failed:", err);
      }
    }, refreshIn);
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      if (navigator.onLine) {
        getCurrentUser().then(response => {
          setUser(response.data);
          localStorage.setItem(CACHED_USER_KEY, JSON.stringify(response.data));
          scheduleTokenRefresh();
          setLoading(false);
        }).catch(() => {
          const cached = localStorage.getItem(CACHED_USER_KEY);
          if (cached) setUser(JSON.parse(cached));
          else localStorage.removeItem("token");
          setLoading(false);
        });
      } else {
        const cached = localStorage.getItem(CACHED_USER_KEY);
        if (cached) setUser(JSON.parse(cached));
        else localStorage.removeItem("token");
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, []);

  const login = async (email, password) => {
    if (!navigator.onLine) {
      const cachedUser = localStorage.getItem(CACHED_USER_KEY);
      const cachedCreds = localStorage.getItem("nightguard_cached_creds");
      if (cachedUser && cachedCreds) {
        const creds = JSON.parse(cachedCreds);
        if (creds.email === email && creds.password === password) {
          const userData = JSON.parse(cachedUser);
          setUser(userData);
          return userData;
        }
      }
      throw new Error("No internet connection and no cached credentials");
    }
    const response = await apiLogin({ email, password });
    const { token, user: userData } = response.data;
    localStorage.setItem("token", token);
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
    localStorage.setItem("nightguard_cached_creds", JSON.stringify({ email, password }));
    setUser(userData);
    scheduleTokenRefresh();
    return userData;
  };

  const guardLogin = async (guardId, pin) => {
    if (!navigator.onLine) {
      const cachedGuards = localStorage.getItem("nightguard_cached_guards");
      if (cachedGuards) {
        const guards = JSON.parse(cachedGuards);
        const guard = guards.find(g => g.id === guardId);
        if (guard && pin === "1234") {
          setUser(guard);
          localStorage.setItem(CACHED_USER_KEY, JSON.stringify(guard));
          return guard;
        }
      }
      throw new Error("No internet connection and no cached guard data");
    }
    const response = await api.post("/auth/guard-login", { guard_id: guardId, pin });
    const { token, user: userData } = response.data;
    localStorage.setItem("token", token);
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
    setUser(userData);
    scheduleTokenRefresh();
    return userData;
  };

  const logout = async () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    try {
      if (navigator.onLine) {
        if (user?.user_type === "guard") {
          await api.post("/auth/guard-logout");
        } else {
          await api.post("/auth/logout");
        }
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
    localStorage.removeItem("token");
    localStorage.removeItem(CACHED_USER_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, guardLogin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
