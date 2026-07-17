import { useOfflineQueue } from './useOfflineQueue';
import api from '../services/api';
import { supabase } from '../lib/supabase';
import { isAppOnline } from '../lib/connectivity';

function shouldQueueFallback(err) {
  const message = String(err?.message || '');
  if (message.toLowerCase().includes('failed fetch') || message.toLowerCase().includes('failed to fetch')) {
    return true;
  }
  if (!err?.response) return true;
  if (err.code === 'ECONNABORTED') return true;
  if (message.includes('Network Error')) return true;
  const status = err.response.status;
  return [401, 403, 408, 429, 500, 502, 503, 504].includes(status);
}

function buildOfflineResponse(data, clientTempId, extra = {}) {
  return {
    ...data,
    id: clientTempId || `offline_${Date.now()}`,
    _offline: true,
    ...extra,
  };
}

// The Supabase facade ignores axios-style { timeout }, so a stalled write would hang forever.
// Race it against a generous timeout; on timeout we throw a response-less error, which
// shouldQueueFallback() treats as a network failure and routes into the offline queue.
// 15s is long enough that a fired timeout almost always means the request never reached the
// server, keeping duplicate-write risk negligible.
const WRITE_TIMEOUT_MS = 15000;

function withWriteTimeout(promise, url) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out: ${url}`)), WRITE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ✅ FIXED: Never makes a network call — reads cached session only
// supabase.auth.getSession() hits the network when offline and hangs for 10-30s
function hasAuthenticatedSession() {
  try {
    // Read directly from Supabase's localStorage key — synchronous, no network
    const keys = Object.keys(localStorage);
    const sessionKey = keys.find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!sessionKey) return false;
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const expiresAt = parsed?.expires_at;
    if (!expiresAt) return Boolean(parsed?.access_token);
    // Treat as valid if not expired (guard against clock skew with 60s buffer)
    return Date.now() / 1000 < expiresAt - 60;
  } catch {
    return false;
  }
}

export function useOfflineApi() {
  const { isOnline, addToQueue } = useOfflineQueue();

  const shouldQueue = (options) => {
    // ✅ Synchronous check — no await, no hanging
    if (!isAppOnline()) return true;
    if (options.forceQueue) return true;
    if (!hasAuthenticatedSession()) return true;
    return false;
  };

  const post = async (url, data, options = {}) => {
    const clientTempId = options.clientTempId || `offline_${Date.now()}`;
    const offlineResponse = options.offlineResponse || buildOfflineResponse(data, clientTempId);

    if (shouldQueue(options)) {
      console.log(`[OfflineApi] POST ${url} - QUEUED (offline/noSession/forced)`, data);
      addToQueue('post', url, data, clientTempId);
      return offlineResponse; // ✅ Returns immediately, no hang
    }

    try {
      console.log(`[OfflineApi] POST ${url} - ATTEMPTING ONLINE`, data);
      const response = await withWriteTimeout(api.post(url, data), url);
      console.log(`[OfflineApi] POST ${url} - SUCCESS`, response.data);
      return response.data;
    } catch (err) {
      if (shouldQueueFallback(err)) {
        console.log(`[OfflineApi] POST ${url} - FALLBACK TO QUEUE:`, err.message);
        addToQueue('post', url, data, clientTempId);
        return offlineResponse;
      }
      console.error(`[OfflineApi] POST ${url} - ERROR:`, err.message);
      throw err;
    }
  };

  const patch = async (url, data, options = {}) => {
    const clientTempId = options.clientTempId || null;
    const offlineResponse = options.offlineResponse || { ...data, _offline: true };

    if (shouldQueue(options)) {
      console.log(`[OfflineApi] PATCH ${url} - QUEUED (offline/noSession/forced)`, data);
      addToQueue('patch', url, data, clientTempId);
      return offlineResponse;
    }

    try {
      console.log(`[OfflineApi] PATCH ${url} - ATTEMPTING ONLINE`, data);
      const response = await withWriteTimeout(api.patch(url, data), url);
      console.log(`[OfflineApi] PATCH ${url} - SUCCESS`, response.data);
      return response.data;
    } catch (err) {
      if (shouldQueueFallback(err)) {
        console.log(`[OfflineApi] PATCH ${url} - FALLBACK TO QUEUE:`, err.message);
        addToQueue('patch', url, data, clientTempId);
        return offlineResponse;
      }
      console.error(`[OfflineApi] PATCH ${url} - ERROR:`, err.message);
      throw err;
    }
  };

  const put = async (url, data, options = {}) => {
    const clientTempId = options.clientTempId || null;
    const offlineResponse = options.offlineResponse || { ...data, _offline: true };

    if (shouldQueue(options)) {
      console.log(`[OfflineApi] PUT ${url} - QUEUED (offline/noSession/forced)`, data);
      addToQueue('put', url, data, clientTempId);
      return offlineResponse;
    }

    try {
      console.log(`[OfflineApi] PUT ${url} - ATTEMPTING ONLINE`, data);
      const response = await withWriteTimeout(api.put(url, data), url);
      console.log(`[OfflineApi] PUT ${url} - SUCCESS`, response.data);
      return response.data;
    } catch (err) {
      if (shouldQueueFallback(err)) {
        console.log(`[OfflineApi] PUT ${url} - FALLBACK TO QUEUE:`, err.message);
        addToQueue('put', url, data, clientTempId);
        return offlineResponse;
      }
      console.error(`[OfflineApi] PUT ${url} - ERROR:`, err.message);
      throw err;
    }
  };

  return { post, patch, put, isOnline };
}
