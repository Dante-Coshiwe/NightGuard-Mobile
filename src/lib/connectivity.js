import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

export const NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT = 'nightguard_connectivity_change';
export const NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT = 'nightguard_connectivity_recheck';

const RECHECK_DEBOUNCE_MS = 1500;
const REACHABILITY_TIMEOUT_MS = 2500;

let monitorInstalled = false;
let currentOnline = true;
let lastDispatchAt = 0;
let readBrowserOnline = () => true;

function emitConnectivityChange(meta = {}) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT, {
    detail: {
      online: currentOnline,
      emittedAt: new Date().toISOString(),
      ...meta,
    },
  }));
}

function canDispatchRecheck(reason) {
  const now = Date.now();
  if (reason === 'online' || reason === 'native-change') {
    lastDispatchAt = now;
    return true;
  }
  if (now - lastDispatchAt < RECHECK_DEBOUNCE_MS) {
    return false;
  }
  lastDispatchAt = now;
  return true;
}

function emitConnectivityRecheck(reason, previousOnline, meta = {}) {
  if (typeof window === 'undefined' || !currentOnline) {
    return false;
  }

  if (!canDispatchRecheck(reason)) {
    return false;
  }

  window.dispatchEvent(new CustomEvent(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, {
    detail: {
      online: true,
      recovered: previousOnline === false,
      reason,
      emittedAt: new Date().toISOString(),
      ...meta,
    },
  }));

  return true;
}

function rememberBrowserOnlineReader() {
  if (typeof navigator === 'undefined') {
    readBrowserOnline = () => true;
    return;
  }

  let proto = navigator;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'onLine');
    if (descriptor) {
      if (typeof descriptor.get === 'function') {
        readBrowserOnline = () => Boolean(descriptor.get.call(navigator));
      } else {
        readBrowserOnline = () => Boolean(descriptor.value);
      }
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }

  readBrowserOnline = () => Boolean(navigator.onLine);
}

function patchNavigatorOnline() {
  if (typeof navigator === 'undefined') return;

  const patchTarget = (target) => {
    if (!target) return false;

    const descriptor = Object.getOwnPropertyDescriptor(target, 'onLine');
    if (descriptor && descriptor.configurable === false) {
      return false;
    }

    try {
      Object.defineProperty(target, 'onLine', {
        configurable: true,
        enumerable: true,
        get() {
          return currentOnline;
        },
      });
      return true;
    } catch {
      return false;
    }
  };

  if (patchTarget(navigator)) return;

  let proto = Object.getPrototypeOf(navigator);
  while (proto) {
    if (patchTarget(proto)) return;
    proto = Object.getPrototypeOf(proto);
  }
}

function setConnectivityState(online, reason, meta = {}) {
  const nextOnline = Boolean(online);
  const previousOnline = currentOnline;
  currentOnline = nextOnline;

  if (previousOnline !== nextOnline || meta.forceChangeEvent) {
    emitConnectivityChange({
      reason,
      changed: previousOnline !== nextOnline,
      ...meta,
    });
  }

  if (nextOnline && (previousOnline !== nextOnline || meta.forceRecheck)) {
    emitConnectivityRecheck(reason, previousOnline, meta);
  }

  return nextOnline;
}

function isNativeAndroid() {
  return Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'android';
}

export function isAppOnline() {
  return currentOnline;
}

export function getConnectivitySnapshot() {
  return { online: currentOnline };
}

export function confirmAppOnline(reason = 'network-success') {
  return setConnectivityState(true, reason, {
    source: 'app-confirmed',
    forceChangeEvent: true,
    forceRecheck: true,
  });
}

async function canReachBackend() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url || typeof fetch !== 'function' || typeof AbortController === 'undefined') {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveNativeOnlineStatus(status) {
  const nativeConnected = Boolean(status?.connected);
  const browserOnline = readBrowserOnline();
  const connectionType = status?.connectionType || 'unknown';
  const statusOnline = nativeConnected || browserOnline || connectionType !== 'none';
  const backendReachable = statusOnline ? false : await canReachBackend();

  return {
    online: statusOnline || backendReachable,
    nativeConnected,
    browserOnline,
    backendReachable,
    connectionType,
  };
}

async function refreshConnectivityState(reason = 'manual') {
  if (typeof window === 'undefined') {
    return currentOnline;
  }

  if (isNativeAndroid()) {
    try {
      const status = await Network.getStatus();
      const resolved = await resolveNativeOnlineStatus(status);
      return setConnectivityState(resolved.online, reason, {
        source: 'capacitor-network',
        nativeConnected: resolved.nativeConnected,
        browserOnline: resolved.browserOnline,
        backendReachable: resolved.backendReachable,
        connectionType: resolved.connectionType,
        forceRecheck: true,
      });
    } catch (err) {
      console.warn('[Connectivity] Native status refresh failed:', err?.message || err);
    }
  }

  return setConnectivityState(readBrowserOnline(), reason, {
    source: 'browser',
    forceRecheck: true,
  });
}

export async function dispatchConnectivityRecheck(reason = 'manual') {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const online = await refreshConnectivityState(reason);
  return Boolean(online);
}

export async function installConnectivityMonitor() {
  if (monitorInstalled || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  monitorInstalled = true;
  rememberBrowserOnlineReader();
  currentOnline = readBrowserOnline();
  patchNavigatorOnline();

  const handleBrowserOnline = () => {
    setConnectivityState(true, 'online', {
      source: 'browser-event',
      forceRecheck: true,
    });
  };

  const handleBrowserOffline = () => {
    if (isNativeAndroid()) {
      refreshConnectivityState('browser-offline');
      return;
    }

    setConnectivityState(false, 'offline', {
      source: 'browser-event',
    });
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      refreshConnectivityState('visibilitychange');
    }
  };

  const handleFocus = () => {
    refreshConnectivityState('focus');
  };

  const handlePageShow = () => {
    refreshConnectivityState('pageshow');
  };

  window.addEventListener('online', handleBrowserOnline);
  window.addEventListener('offline', handleBrowserOffline);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleFocus);
  window.addEventListener('pageshow', handlePageShow);

  if (isNativeAndroid()) {
    try {
      const status = await Network.getStatus();
      const resolved = await resolveNativeOnlineStatus(status);
      setConnectivityState(resolved.online, 'native-init', {
        source: 'capacitor-network',
        nativeConnected: resolved.nativeConnected,
        browserOnline: resolved.browserOnline,
        backendReachable: resolved.backendReachable,
        connectionType: resolved.connectionType,
        forceChangeEvent: true,
        forceRecheck: resolved.online,
      });

      await Network.addListener('networkStatusChange', async (statusChange) => {
        const next = await resolveNativeOnlineStatus(statusChange);
        setConnectivityState(next.online, 'native-change', {
          source: 'capacitor-network',
          nativeConnected: next.nativeConnected,
          browserOnline: next.browserOnline,
          backendReachable: next.backendReachable,
          connectionType: next.connectionType,
          forceRecheck: next.online,
        });
      });
    } catch (err) {
      console.warn('[Connectivity] Failed to attach Capacitor Network listener:', err?.message || err);
      setConnectivityState(readBrowserOnline(), 'native-fallback', {
        source: 'browser',
        forceChangeEvent: true,
      });
    }
    return;
  }

  setConnectivityState(readBrowserOnline(), 'browser-init', {
    source: 'browser',
    forceChangeEvent: true,
  });
}
