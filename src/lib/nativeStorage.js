import { Capacitor } from '@capacitor/core';
import { readJsonFileWithRecovery, writeJsonFileAtomic } from './atomicFile';

const STORAGE_FILE = 'nightguard-storage.json';
const WRITE_DEBOUNCE_MS = 120;

// Keys whose loss would cost a guard's work. These skip the debounce and hit the disk
// immediately, because Android can kill a backgrounded app between one tick and the next.
const CRITICAL_KEYS = new Set([
  'nightguard_offline_queue',
  'nightguard_offline_queue_dead',
  'nightguard_patrol_outbox',
  'nightguard_active_patrol_session',
  'nightguard_nfc_scans',
  'nightguard_shift_session',
]);

let initialised = false;
let flushTimer = null;
let pendingFlush = Promise.resolve();
let storageState = {};

function isNativePersistentPlatform() {
  return Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'android';
}

function listKeys() {
  return Object.keys(storageState);
}

function readString(key) {
  return Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null;
}

function writeString(key, value) {
  storageState = {
    ...storageState,
    [key]: String(value),
  };
}

function removeKey(key) {
  if (!Object.prototype.hasOwnProperty.call(storageState, key)) return;
  const next = { ...storageState };
  delete next[key];
  storageState = next;
}

function clearState() {
  storageState = {};
}

function serialiseState() {
  try {
    // Quick validation by attempting to stringify a copy first
    const testCopy = JSON.parse(JSON.stringify(storageState));
    return JSON.stringify(testCopy);
  } catch (err) {
    console.error('[NativeStorage] serialiseState() failed (likely circular ref):', err.message);
    // Fallback: only store primitive string/number/boolean values
    const safe = {};
    for (const [k, v] of Object.entries(storageState)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
        safe[k] = v;
      }
    }
    return JSON.stringify(safe);
  }
}

async function persistState() {
  await writeJsonFileAtomic(STORAGE_FILE, serialiseState());
}

function flushPersistSoon() {
  pendingFlush = pendingFlush
    .catch(() => null)
    .then(() => persistState())
    .catch((err) => {
      console.error('[NativeStorage] Persist failed:', err?.message || err);
    });
}

function flushPersistNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushPersistSoon();
}

function schedulePersist() {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPersistSoon();
  }, WRITE_DEBOUNCE_MS);
}

function safeMirrorToOriginal(originalStorage, action, ...args) {
  try {
    const method = originalStorage?.[action];
    if (typeof method === 'function') {
      method.apply(originalStorage, args);
    }
  } catch (err) {
    console.warn(`[NativeStorage] Original localStorage ${action} failed:`, err?.message || err);
  }
}

function copyOriginalState(originalStorage) {
  if (!originalStorage) return {};

  const copied = {};
  try {
    for (let index = 0; index < originalStorage.length; index += 1) {
      const key = originalStorage.key(index);
      if (!key) continue;
      const value = originalStorage.getItem(key);
      if (value !== null) {
        copied[key] = value;
      }
    }
  } catch (err) {
    console.warn('[NativeStorage] Could not copy browser localStorage:', err?.message || err);
  }
  return copied;
}

async function readPersistedState() {
  return readJsonFileWithRecovery(STORAGE_FILE);
}

function createStorageProxy(originalStorage) {
  const api = {
    get length() {
      return listKeys().length;
    },
    clear() {
      clearState();
      schedulePersist();
      safeMirrorToOriginal(originalStorage, 'clear');
    },
    getItem(key) {
      return readString(String(key));
    },
    key(index) {
      return listKeys()[Number(index)] ?? null;
    },
    removeItem(key) {
      const normalisedKey = String(key);
      removeKey(normalisedKey);
      schedulePersist();
      if (CRITICAL_KEYS.has(normalisedKey)) {
        flushPersistNow();
      }
      safeMirrorToOriginal(originalStorage, 'removeItem', normalisedKey);
    },
    setItem(key, value) {
      const normalisedKey = String(key);
      const normalisedValue = String(value);
      writeString(normalisedKey, normalisedValue);
      schedulePersist();
      if (CRITICAL_KEYS.has(normalisedKey)) {
        flushPersistNow();
      }
      safeMirrorToOriginal(originalStorage, 'setItem', normalisedKey, normalisedValue);
    },
  };

  return new Proxy(api, {
    deleteProperty(_, property) {
      if (typeof property === 'string') {
        api.removeItem(property);
        return true;
      }
      return false;
    },
    get(target, property, receiver) {
      if (property === Symbol.toStringTag) {
        return 'Storage';
      }
      if (typeof property === 'string' && !(property in target)) {
        return readString(property);
      }
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === 'string' && !(property in target) && Object.prototype.hasOwnProperty.call(storageState, property)) {
        return {
          configurable: true,
          enumerable: true,
          value: readString(property),
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(storageState, property)) {
        return true;
      }
      return Reflect.has(target, property);
    },
    ownKeys() {
      return listKeys();
    },
    set(_, property, value) {
      if (typeof property === 'string') {
        api.setItem(property, value);
        return true;
      }
      return false;
    },
  });
}

export async function installNativeStoragePersistence() {
  if (initialised || !isNativePersistentPlatform()) {
    return;
  }

  initialised = true;
  const originalStorage = globalThis.localStorage;
  const persistedState = await readPersistedState();
  const originalState = copyOriginalState(originalStorage);

  storageState = {
    ...persistedState,
    ...originalState,
  };

  const proxy = createStorageProxy(originalStorage);
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: proxy,
      writable: false,
    });
    if (globalThis.window && globalThis.window !== globalThis) {
      Object.defineProperty(globalThis.window, 'localStorage', {
        configurable: true,
        enumerable: true,
        value: proxy,
        writable: false,
      });
    }
  } catch (err) {
    console.warn('[NativeStorage] Failed to replace localStorage object:', err?.message || err);
  }

  safeMirrorToOriginal(originalStorage, 'clear');
  Object.entries(storageState).forEach(([key, value]) => {
    safeMirrorToOriginal(originalStorage, 'setItem', key, value);
  });

  await persistState().catch((err) => {
    console.error('[NativeStorage] Initial persist failed:', err?.message || err);
  });
  window.addEventListener('beforeunload', flushPersistNow);
  window.addEventListener('pagehide', flushPersistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPersistNow();
    }
  });

  // beforeunload does not fire when Android kills a backgrounded app, so the last reliable moment
  // to get everything on disk is the pause event from the native shell.
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) flushPersistNow();
    });
    App.addListener('pause', flushPersistNow);
  } catch (err) {
    console.warn('[NativeStorage] Could not attach app lifecycle flush:', err?.message || err);
  }
  console.info(`[NativeStorage] Android persistence enabled with ${listKeys().length} stored keys`);
}
