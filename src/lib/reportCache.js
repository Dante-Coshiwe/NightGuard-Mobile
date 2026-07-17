import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const REPORT_CACHE_FILE = 'nightguard-report-cache.json';
const WRITE_DEBOUNCE_MS = 120;

let initialised = false;
let state = {};
let flushTimer = null;

function isNativeAndroid() {
  return Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'android';
}

function readFromLocalStorage() {
  try {
    const incidentsRaw = localStorage.getItem('cached_incidents');
    const obRaw = localStorage.getItem('cached_ob_entries');

    return {
      cached_incidents: incidentsRaw ? JSON.parse(incidentsRaw) : [],
      cached_ob_entries: obRaw ? JSON.parse(obRaw) : [],
    };
  } catch {
    return { cached_incidents: [], cached_ob_entries: [] };
  }
}

async function readFromFilesystem() {
  try {
    const { data } = await Filesystem.readFile({
      path: REPORT_CACHE_FILE,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return data ? JSON.parse(data) : {};
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (message.includes('does not exist') || message.includes('no such file')) return {};
    console.warn('[ReportCache] Failed to read filesystem cache:', err?.message || err);
    return {};
  }
}

async function ensureLoaded() {
  if (initialised) return;
  initialised = true;

  if (!isNativeAndroid()) {
    state = readFromLocalStorage();
    return;
  }

  state = {
    ...readFromLocalStorage(),
    ...(await readFromFilesystem()),
  };

  // ✅ Ensure arrays are always arrays to prevent TypeError on .map/.filter
  state.cached_incidents = Array.isArray(state.cached_incidents) ? state.cached_incidents : [];
  state.cached_ob_entries = Array.isArray(state.cached_ob_entries) ? state.cached_ob_entries : [];
}

function schedulePersist() {
  if (!isNativeAndroid()) return; // localStorage mirror is done in setters

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      await Filesystem.writeFile({
        path: REPORT_CACHE_FILE,
        data: JSON.stringify(state),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch (err) {
      console.error('[ReportCache] Persist failed:', err?.message || err);
    }
  }, WRITE_DEBOUNCE_MS);
}

async function persistNow() {
  if (!isNativeAndroid()) return;
  try {
    await Filesystem.writeFile({
      path: REPORT_CACHE_FILE,
      data: JSON.stringify(state),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch (err) {
    console.error('[ReportCache] PersistNow failed:', err?.message || err);
  }
}

export async function getCachedIncidents() {
  await ensureLoaded();
  return Array.isArray(state.cached_incidents) ? state.cached_incidents : [];
}

export async function setCachedIncidents(incidents) {
  await ensureLoaded();
  state.cached_incidents = Array.isArray(incidents) ? incidents : [];
  // Persist immediately on Android so the cache survives sudden kills/reboots.
  // (Debounce is kept for other potential call sites, but we also flush here.)
  schedulePersist();
  await persistNow();

  // Best-effort mirror for any legacy code still reading localStorage directly.
  try {
    localStorage.setItem('cached_incidents', JSON.stringify(state.cached_incidents));
  } catch {
    // ignore
  }
}

export async function getCachedObEntries() {
  await ensureLoaded();
  return Array.isArray(state.cached_ob_entries) ? state.cached_ob_entries : [];
}

export async function setCachedObEntries(entries) {
  await ensureLoaded();
  state.cached_ob_entries = Array.isArray(entries) ? entries : [];
  // Persist immediately on Android so the cache survives sudden kills/reboots.
  schedulePersist();
  await persistNow();

  // Best-effort mirror for any legacy code still reading localStorage directly.
  try {
    localStorage.setItem('cached_ob_entries', JSON.stringify(state.cached_ob_entries));
  } catch {
    // ignore
  }
}

// Useful for tests/debugging and for forcing immediate persistence.
export async function flushReportCache() {
  await ensureLoaded();
  await persistNow();
}

