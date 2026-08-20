import { Preferences } from '@capacitor/preferences';
import { isUuidString } from './uuid';

const LOOKUP_KEY = 'nightguard_lookup_data';
const PATROL_CONFIG_KEY = 'nightguard_patrol_config';
const NFC_SCANS_KEY = 'nightguard_nfc_scans';
const SHIFT_SESSION_KEY = 'nightguard_shift_session';
const QUICK_SWITCH_KEY = 'nightguard_quick_switch_enabled';
const CACHED_GUARDS_KEY = 'nightguard_cached_guards';
const PRECLEARED_PEDESTRIANS_KEY = 'nightguard_precleared_pedestrians';
const BLACKLISTED_VEHICLES_KEY = 'nightguard_blacklisted_vehicles';
// The dead key from the old "Email delivery" panel that never delivered anything. Only
// clearLegacyReportEmailSettings() touches it. REPORT_RECIPIENTS_KEY below is the live one
// and is deliberately a different name — reusing this one would resurrect a stale blob of
// the old shape on every handset that still carries it.
const REPORT_EMAIL_SETTINGS_KEY = 'nightguard_report_email_settings';
const REPORT_RECIPIENTS_KEY = 'nightguard_report_recipients';
const LAST_SYNC_KEY = 'nightguard_last_sync_at';
const DEVICE_ID_KEY = 'nightguard_device_id';
const SITE_SETTINGS_KEY = 'nightguard_site_settings';
const DEVICE_SETTINGS_KEY = 'nightguard_device_settings';
const PENDING_SCHEMA_SYNC_KEY = 'nightguard_pending_schema_sync';
const SYNC_LOGS_KEY = 'nightguard_sync_logs';
const CACHED_PEDESTRIANS_KEY = 'cached_pedestrians';
const CACHED_VEHICLES_KEY = 'cached_vehicles';
const GENERAL_GUARD_SEEDED_KEY = 'general_guard_seeded';

const ENV_LOCATION_NAME = import.meta.env.VITE_LOCATION_NAME || import.meta.env.VITE_SITE_NAME || 'Location';
export const GENERAL_GUARD_ID = '00000000-0000-0000-0000-000000000000';
export const LEGACY_GENERAL_GUARD_ID = 'general-guard';
export const GENERAL_GUARD = {
  id: GENERAL_GUARD_ID,
  full_name: 'General Guard',
  name: 'General Guard',
  phone: '',
  pin: '0000',
  guard_pin: '0000',
  badge_number: 'GG-0000',
  is_active: true,
  user_type: 'guard',
  role: 'guard',
  _localOnly: true,
  _is_general_guard: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const DEFAULT_LOOKUP_DATA = {
  shiftOptions: ['Day Shift', 'Night Shift'],
  pedestrianTypes: ['Visitor', 'Contractor', 'Resident', 'Delivery'],
  vehicleTypes: ['Visitor', 'Contractor', 'Delivery', 'Service'],
  units: ['Reception', 'Block A', 'Block B'],
  incidentTypes: ['Suspicious Activity', 'Damage', 'Medical', 'Access Control'],
};

export const DEFAULT_PATROL_CONFIG = {
  patrolScheduleEnabled: true,
  patrolTimes: ['06:00', '12:00', '18:00', '00:00'],
  patrolIntervalMinutes: 60,
  minimumTagCount: 3,
  // GPS-primary: seeded points carry no NFC tag. A guard drops a GPS pin per point,
  // and can optionally link a real NFC tag later. Seeding fake tag_uids caused the
  // global patrol_checkpoints_tag_uid_key unique violation when the same defaults
  // were saved from more than one site/device.
  checkpoints: [
    { id: 'cp-1', name: 'Main Gate', tag_uid: '', zone: 'Perimeter', required: true },
    { id: 'cp-2', name: 'Parking Gate', tag_uid: '', zone: 'Parking', required: true },
    { id: 'cp-3', name: 'Reception Door', tag_uid: '', zone: 'Lobby', required: true },
  ],
};

const CACHED_PATROLS_KEY = 'nightguard_cached_patrols';
const CACHED_SHIFTS_KEY = 'nightguard_cached_completed_shifts';

function normalisePatrolTimes(times) {
  const values = Array.isArray(times) ? times : [];
  return Array.from(new Set(
    values
      .map((time) => String(time || '').trim())
      .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
  )).sort();
}

export const DEFAULT_SITE_SETTINGS = {
  // Dev builds only. A production bundle ships to every device on the channel,
  // so a baked site id is a wrong answer waiting for any device whose binding
  // has not resolved yet — see src/lib/siteResolver.js.
  id: import.meta.env.DEV ? (import.meta.env.VITE_SITE_ID || '') : '',
  site_name: ENV_LOCATION_NAME,
  location_name: ENV_LOCATION_NAME,
  address: '',
  contact_person: '',
  contact_phone: '',
  organizations: { org_name: '' },
  devices: [],
};

export const DEFAULT_DEVICE_SETTINGS = {
  autoExit: false,
  allowQuickGuardSwitch: false,
  allow_quick_guard_switch: false,
  deviceDescription: '',
  // Whether going on duty locks this handset to NightGuard. Defaults to ON so existing
  // devices keep the behaviour they already have. Deliberately device-scoped and local:
  // one site can have a locked patrol phone and an unlocked gatehouse tablet, and the
  // admin sets it while standing at the device.
  kioskModeEnabled: true,
};

function readJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    const result = stored ? JSON.parse(stored) : fallback;
    if (stored) {
      console.log(`[DeviceStore] READ "${key}":`, result);
    }
    return result;
  } catch (err) {
    console.error(`[DeviceStore] READ ERROR for "${key}":`, err.message);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    const jsonStr = JSON.stringify(value);
    localStorage.setItem(key, jsonStr);
    console.log(`[DeviceStore] WRITE "${key}": count=${Array.isArray(value) ? value.length : 'object'}, size=${jsonStr.length}bytes`, value);
    return value;
  } catch (err) {
    console.error(`[DeviceStore] WRITE ERROR for "${key}":`, err.message);
    return value;
  }
}

function dispatchStoreEvent(name) {
  console.log(`[DeviceStore] DISPATCH EVENT "${name}"`);
  window.dispatchEvent(new Event(name));
}

// Keeps the FIRST occurrence of each id.
//
// Callers upsert by prepending the fresh copy — `saveCachedX([updated, ...cached])` — so a
// last-wins dedupe let the stale cached entry overwrite the update and silently throw it away. A
// patrol that synced, or a visitor that was marked exited, kept showing its old state forever.
function dedupeById(entries = []) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!entry?.id) return;
    const key = String(entry.id);
    if (!map.has(key)) map.set(key, entry);
  });
  return Array.from(map.values());
}

// Stop a cache growing until localStorage throws and NEW writes start failing silently — the
// newest records are the first thing lost when the quota goes. Entries still waiting to sync are
// kept no matter how old: they are the only copy that exists.
function capCache(entries, limit) {
  if (entries.length <= limit) return entries;
  const isPending = (entry) => entry?._offline || entry?.offline || entry?._pendingExit;
  const pending = entries.filter(isPending);
  const synced = entries.filter((entry) => !isPending(entry));
  return [...pending, ...synced.slice(0, Math.max(limit - pending.length, 0))];
}

const CACHED_PATROLS_LIMIT = 200;
const CACHED_VISITORS_LIMIT = 500;
const CACHED_SHIFTS_LIMIT = 200;

function normaliseGuard(guard) {
  const isGeneralGuard = String(guard?.id) === GENERAL_GUARD_ID ||
    String(guard?.id) === LEGACY_GENERAL_GUARD_ID ||
    guard?._is_general_guard === true;
  if (isGeneralGuard) {
    return {
      ...GENERAL_GUARD,
      ...guard,
      id: GENERAL_GUARD_ID,
      full_name: 'General Guard',
      name: 'General Guard',
      pin: '0000',
      guard_pin: '0000',
      badge_number: 'GG-0000',
      is_active: true,
      _localOnly: true,
      _is_general_guard: true,
    };
  }

  return {
    ...GENERAL_GUARD,
    ...guard,
    id: guard.id,
    full_name: guard.full_name || guard.name || 'Unnamed Guard',
    name: guard.name || guard.full_name || 'Unnamed Guard',
    pin: String(guard.pin || guard.guard_pin || '1234'),
    guard_pin: String(guard.guard_pin || guard.pin || '1234'),
    is_active: guard.is_active !== false,
    user_type: guard.user_type || 'guard',
    role: guard.role || guard.user_type || 'guard',
    _localOnly: guard._localOnly !== false,
  };
}

function mergeWithGeneralGuard(guards = []) {
  const existingGeneralGuard = (guards || [])
    .map(normaliseGuard)
    .find((guard) => isGeneralGuardId(guard?.id));

  return [
    {
      ...GENERAL_GUARD,
      ...(existingGeneralGuard || {}),
      id: GENERAL_GUARD_ID,
      full_name: GENERAL_GUARD.full_name,
      name: GENERAL_GUARD.name,
      pin: GENERAL_GUARD.pin,
      guard_pin: GENERAL_GUARD.guard_pin,
      is_active: true,
      _localOnly: true,
      _is_general_guard: true,
    },
  ];
}

export function isGeneralGuardId(id) {
  return String(id) === GENERAL_GUARD_ID || String(id) === LEGACY_GENERAL_GUARD_ID;
}

export async function seedGeneralGuard(siteSettings = getCachedSiteSettings()) {
  const stampedGeneralGuard = {
    ...GENERAL_GUARD,
    site_id: siteSettings?.id || GENERAL_GUARD.site_id || null,
    organization_id: siteSettings?.organization_id || siteSettings?.org_id || siteSettings?.organizations?.id || null,
    updated_at: new Date().toISOString(),
  };
  const saved = saveCachedGuards([stampedGeneralGuard, ...readJson(CACHED_GUARDS_KEY, [])]);
  localStorage.setItem(GENERAL_GUARD_SEEDED_KEY, 'true');
  try {
    await Preferences.set({ key: GENERAL_GUARD_SEEDED_KEY, value: 'true' });
  } catch (err) {
    console.warn('[DeviceStore] Unable to persist general_guard_seeded:', err?.message || err);
  }
  return saved;
}

export function getLookupData() {
  return {
    ...DEFAULT_LOOKUP_DATA,
    ...readJson(LOOKUP_KEY, {}),
  };
}

export function saveLookupData(data) {
  const saved = writeJson(LOOKUP_KEY, data);
  dispatchStoreEvent('nightguard_lookup_updated');
  return saved;
}

export function getPatrolConfig() {
  const stored = readJson(PATROL_CONFIG_KEY, {});
  const patrolTimes = normalisePatrolTimes(stored.patrolTimes || stored.patrol_times);
  return {
    ...DEFAULT_PATROL_CONFIG,
    ...stored,
    patrolTimes: patrolTimes.length ? patrolTimes : DEFAULT_PATROL_CONFIG.patrolTimes,
    checkpoints: stored.checkpoints?.length ? stored.checkpoints : DEFAULT_PATROL_CONFIG.checkpoints,
  };
}

export function savePatrolConfig(data) {
  const saved = writeJson(PATROL_CONFIG_KEY, {
    ...data,
    patrolTimes: normalisePatrolTimes(data?.patrolTimes || data?.patrol_times),
  });
  dispatchStoreEvent('nightguard_patrol_config_updated');
  return saved;
}

export function getCachedPatrols() {
  return readJson(CACHED_PATROLS_KEY, []);
}

export function saveCachedPatrols(entries) {
  const saved = writeJson(CACHED_PATROLS_KEY, capCache(dedupeById(entries), CACHED_PATROLS_LIMIT));
  dispatchStoreEvent('nightguard_patrols_updated');
  return saved;
}

export function upsertCachedPatrol(entry) {
  return saveCachedPatrols([entry, ...getCachedPatrols()]);
}

// Completed shifts had no local copy at all, so both shift reports showed nothing but an error
// message the moment the device was offline. Cache them like every other read.
export function getCachedCompletedShifts() {
  return readJson(CACHED_SHIFTS_KEY, []);
}

export function saveCachedCompletedShifts(entries) {
  return writeJson(CACHED_SHIFTS_KEY, capCache(dedupeById(entries), CACHED_SHIFTS_LIMIT));
}

export function getNfcScans() {
  return readJson(NFC_SCANS_KEY, []);
}

export function saveNfcScans(scans) {
  return writeJson(NFC_SCANS_KEY, scans);
}

const NFC_SCAN_HISTORY_LIMIT = 500;

// localStorage holds a few MB and every GPS check-in appends a row that was never removed. Once
// the quota is reached the write throws and NEW scans stop persisting — the freshest evidence is
// the first thing lost, silently. Trim the oldest scans that have ALREADY reached the server;
// anything still pending sync is kept no matter how old, because it is the only copy.
function trimNfcScans(scans) {
  if (scans.length <= NFC_SCAN_HISTORY_LIMIT) return scans;

  const pending = scans.filter((scan) => scan?.offline || scan?._offline);
  const synced = scans.filter((scan) => !(scan?.offline || scan?._offline));
  const keep = synced.slice(0, Math.max(NFC_SCAN_HISTORY_LIMIT - pending.length, 0));
  return [...pending, ...keep].sort((a, b) => new Date(b?.scanned_at || 0) - new Date(a?.scanned_at || 0));
}

export function appendNfcScan(scan) {
  const updated = trimNfcScans([scan, ...getNfcScans()]);
  saveNfcScans(updated);
  return updated;
}

// A device rebound to another site must not keep the previous site's patrol setup or history
// visible — that layout belongs to a different client. Anything still waiting to sync is KEPT: it
// was recorded at the old site and must still be delivered there.
export function purgeSiteScopedPatrolCaches() {
  try {
    localStorage.removeItem(PATROL_CONFIG_KEY);
  } catch { /* ignore */ }
  saveCachedPatrols([]);
  saveNfcScans(getNfcScans().filter((scan) => scan?.offline || scan?._offline));
  dispatchStoreEvent('nightguard_patrol_config_updated');
  console.warn('[DeviceStore] site changed — cleared patrol config, patrol list and synced scans');
}

export const NIGHTGUARD_SHIFT_SESSION_EVENT = 'nightguard_shift_session_updated';

export function getShiftSession() {
  return readJson(SHIFT_SESSION_KEY, null);
}

export function saveShiftSession(session) {
  const saved = writeJson(SHIFT_SESSION_KEY, session);
  // AuthContext mirrors the session in React state, and callers read
  // `shiftSession?.id || getShiftSession()?.id` — state first. Without this the offline queue
  // can reconcile the id in localStorage and every screen would still send the stale one.
  dispatchStoreEvent(NIGHTGUARD_SHIFT_SESSION_EVENT);
  return saved;
}

// The device session is created locally with a `shift_<ts>` id, because it must work with no
// network. The server drops any non-UUID id (see startShiftRecord) and mints its own, so once
// /shifts/start syncs we have to adopt the real UUID here — otherwise every record written
// afterwards carries a `shift_…` string, `nullableUuid()` turns it into null on insert, and
// nothing is ever attributable to the session. That is exactly why shift_id was null everywhere.
export function reconcileShiftSessionId(localId, serverId) {
  if (!isUuidString(serverId)) return false;
  const session = getShiftSession();
  if (!session || session.id === serverId) return false;
  if (localId && session.id !== localId) return false;
  saveShiftSession({ ...session, id: serverId, localId: session.id });
  console.info(`[DeviceStore] adopted server shift id ${serverId} (was ${session.id})`);
  return true;
}

export function clearShiftSession() {
  localStorage.removeItem(SHIFT_SESSION_KEY);
}

export function getQuickSwitchEnabled() {
  return false;
}

export function saveQuickSwitchEnabled() {
  const next = false;
  localStorage.setItem(QUICK_SWITCH_KEY, String(next));
  writeJson(DEVICE_SETTINGS_KEY, {
    ...getDeviceSettings(),
    allowQuickGuardSwitch: next,
    allow_quick_guard_switch: next,
  });
  dispatchStoreEvent('nightguard_device_settings_updated');
  return next;
}

export function getCachedGuards() {
  const result = mergeWithGeneralGuard(readJson(CACHED_GUARDS_KEY, []).map(normaliseGuard));
  console.log(`[DeviceStore] getCachedGuards(): ${result.length} entries`);
  return result;
}

export function saveCachedGuards(guards) {
  const merged = mergeWithGeneralGuard((guards || []).map(normaliseGuard));
  const saved = writeJson(CACHED_GUARDS_KEY, merged);
  console.log(`[DeviceStore] saveCachedGuards(): saved ${merged.length} entries`);
  return saved;
}

export function upsertCachedGuard(guard) {
  console.log(`[DeviceStore] upsertCachedGuard(): id="${guard.id}", name="${guard.full_name || guard.name}"`);
  const nextGuard = normaliseGuard(guard);
  const existing = getCachedGuards();
  const next = existing.some((item) => String(item.id) === String(nextGuard.id))
    ? existing.map((item) => (String(item.id) === String(nextGuard.id) ? { ...item, ...nextGuard } : item))
    : [...existing, nextGuard];
  return saveCachedGuards(next);
}

export function updateCachedGuard(guardId, updates) {
  console.log(`[DeviceStore] updateCachedGuard(): id="${guardId}", updates=`, updates);
  const next = getCachedGuards().map((guard) => (
    String(guard.id) === String(guardId) ? normaliseGuard({ ...guard, ...updates }) : guard
  ));
  return saveCachedGuards(next);
}

export function getCachedSiteSettings() {
  const stored = readJson(SITE_SETTINGS_KEY, {});
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...stored,
    location_name: stored.location_name || stored.site_name || DEFAULT_SITE_SETTINGS.location_name,
    site_name: stored.site_name || stored.location_name || DEFAULT_SITE_SETTINGS.site_name,
    organizations: stored.organizations || DEFAULT_SITE_SETTINGS.organizations,
    devices: Array.isArray(stored.devices) ? stored.devices : DEFAULT_SITE_SETTINGS.devices,
  };
}

export function clearCachedSiteSettings() {
  try {
    localStorage.removeItem(SITE_SETTINGS_KEY);
  } catch { /* ignore */ }
  dispatchStoreEvent('nightguard_site_settings_updated');
  return getCachedSiteSettings();
}

export function saveCachedSiteSettings(settings) {
  const next = {
    ...getCachedSiteSettings(),
    ...settings,
    site_name: settings?.site_name || settings?.location_name || getCachedSiteSettings().site_name,
    location_name: settings?.location_name || settings?.site_name || getCachedSiteSettings().location_name,
  };
  const saved = writeJson(SITE_SETTINGS_KEY, next);
  dispatchStoreEvent('nightguard_site_settings_updated');
  return saved;
}

export function getLocationName() {
  const cached = getCachedSiteSettings();
  return cached.location_name || cached.site_name || ENV_LOCATION_NAME;
}

export function getDeviceSettings() {
  return {
    ...DEFAULT_DEVICE_SETTINGS,
    ...readJson(DEVICE_SETTINGS_KEY, {}),
  };
}

export function saveDeviceSettings(settings) {
  const saved = writeJson(DEVICE_SETTINGS_KEY, {
    ...getDeviceSettings(),
    ...settings,
  });
  dispatchStoreEvent('nightguard_device_settings_updated');
  return saved;
}

export function getPreclearedPedestrians() {
  return readJson(PRECLEARED_PEDESTRIANS_KEY, []);
}

export function savePreclearedPedestrians(entries) {
  return writeJson(PRECLEARED_PEDESTRIANS_KEY, entries);
}

export function appendPreclearedPedestrian(entry) {
  const updated = [entry, ...getPreclearedPedestrians()];
  savePreclearedPedestrians(updated);
  return updated;
}

export function getBlacklistedVehicles() {
  return readJson(BLACKLISTED_VEHICLES_KEY, []);
}

export function saveBlacklistedVehicles(entries) {
  return writeJson(BLACKLISTED_VEHICLES_KEY, entries);
}

export function appendBlacklistedVehicle(entry) {
  const updated = [entry, ...getBlacklistedVehicles()];
  saveBlacklistedVehicles(updated);
  return updated;
}

export function removeBlacklistedVehicle(licensePlate) {
  const updated = getBlacklistedVehicles().filter(
    (entry) => entry.licensePlate?.toLowerCase() !== String(licensePlate).toLowerCase()
  );
  saveBlacklistedVehicles(updated);
  return updated;
}

export function getCachedPedestrians() {
  const result = readJson(CACHED_PEDESTRIANS_KEY, []);
  console.log(`[DeviceStore] getCachedPedestrians(): ${result.length} entries`);
  return result;
}

export function saveCachedPedestrians(entries) {
  const deduped = capCache(dedupeById(entries), CACHED_VISITORS_LIMIT);
  const saved = writeJson(CACHED_PEDESTRIANS_KEY, deduped);
  console.log(`[DeviceStore] saveCachedPedestrians(): saved ${deduped.length} entries`);
  dispatchStoreEvent('nightguard_pedestrians_updated');
  return saved;
}

export function upsertCachedPedestrian(entry) {
  console.log(`[DeviceStore] upsertCachedPedestrian(): adding/updating id="${entry.id}", name="${entry.name}"`);
  return saveCachedPedestrians([entry, ...getCachedPedestrians()]);
}

export function updateCachedPedestrian(id, updates) {
  console.log(`[DeviceStore] updateCachedPedestrian(): id="${id}", updates=`, updates);
  return saveCachedPedestrians(
    getCachedPedestrians().map((entry) => (
      String(entry.id) === String(id) ? { ...entry, ...updates } : entry
    ))
  );
}

export function getCachedVehicles() {
  const result = readJson(CACHED_VEHICLES_KEY, []);
  console.log(`[DeviceStore] getCachedVehicles(): ${result.length} entries`);
  return result;
}

export function saveCachedVehicles(entries) {
  const deduped = capCache(dedupeById(entries), CACHED_VISITORS_LIMIT);
  const saved = writeJson(CACHED_VEHICLES_KEY, deduped);
  console.log(`[DeviceStore] saveCachedVehicles(): saved ${deduped.length} entries`);
  dispatchStoreEvent('nightguard_vehicles_updated');
  return saved;
}

export function upsertCachedVehicle(entry) {
  console.log(`[DeviceStore] upsertCachedVehicle(): adding/updating id="${entry.id}", plate="${entry.licensePlate}"`);
  return saveCachedVehicles([entry, ...getCachedVehicles()]);
}

export function updateCachedVehicle(id, updates) {
  console.log(`[DeviceStore] updateCachedVehicle(): id="${id}", updates=`, updates);
  return saveCachedVehicles(
    getCachedVehicles().map((entry) => (
      String(entry.id) === String(id) ? { ...entry, ...updates } : entry
    ))
  );
}

// Report email settings (recipients, subject, a nightly send time) lived here to feed
// an "Email delivery" panel that never delivered any email — see ShareButton in
// components/ReportKit.jsx. Reports are shared from the device now, so there is
// nothing to store. Old devices keep a stale key in localStorage; it is harmless and
// gets dropped whenever the app's storage is cleared.
export function clearLegacyReportEmailSettings() {
  try {
    localStorage.removeItem(REPORT_EMAIL_SETTINGS_KEY);
  } catch { /* ignore */ }
}

// Who this SITE's automated reports are emailed to. Cached so the config screen is readable
// with no signal, which on a guard's handset is the normal condition rather than the fault.
//
// ⚠ THE CACHE CARRIES ITS OWN site_id AND IS ONLY EVER RETURNED FOR A MATCHING SITE.
// A location admin can sign in to any site they hold, and unbinding or re-homing a handset is
// ordinary admin work — so this device does not stay on one site for its lifetime. A cached
// blob returned after a re-bind would show the previous client's addresses on the new
// client's screen, and the admin would have every reason to believe they were editing the
// site named in the header. Treat a mismatch as no cache at all: an empty screen is honest,
// a confidently wrong one is not.
//
// Deliberately NOT in nativeStorage's CRITICAL_KEYS. This is a few email addresses that can
// always be re-read from the server; every write to a critical key re-serialises the entire
// storage state to disk, and that cost belongs to the outbox, not to a settings screen.
export function getCachedReportRecipients(siteId) {
  if (!siteId) return null;
  const stored = readJson(REPORT_RECIPIENTS_KEY, null);
  if (!stored || String(stored.site_id) !== String(siteId)) return null;
  return stored;
}

export function saveCachedReportRecipients(record) {
  if (!record?.site_id) return null;
  const saved = writeJson(REPORT_RECIPIENTS_KEY, record);
  dispatchStoreEvent('nightguard_report_recipients_updated');
  return saved;
}

export function getLastSyncAt() {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function saveLastSyncAt(value = new Date().toISOString()) {
  localStorage.setItem(LAST_SYNC_KEY, value);
  const currentLogs = readJson(SYNC_LOGS_KEY, []);
  writeJson(SYNC_LOGS_KEY, [
    {
      id: `sync_${Date.now()}`,
      sync_status: 'completed',
      completed_at: value,
      created_at: value,
    },
    ...currentLogs,
  ].slice(0, 25));
  return value;
}

export function getSyncLogs() {
  return readJson(SYNC_LOGS_KEY, []);
}

export function getDeviceId() {
  return localStorage.getItem(DEVICE_ID_KEY) || null;
}
export function setDeviceId(id) {
  localStorage.setItem(DEVICE_ID_KEY, id);
  dispatchStoreEvent('nightguard_device_settings_updated');
  return id;
}
// Resolve this device's PERMANENT id. On Android the id is derived from the
// hardware identity (Settings.Secure.ANDROID_ID via @capacitor/device): it is
// unique per device, survives app uninstall/reinstall, and only changes on a
// factory reset — so one physical device is always ONE device in the logs.
// The old scheme (random string in localStorage) minted a brand-new "device"
// on every reinstall, which is how two test phones became 13 devices.
// Web / old shells without the Device plugin keep the random-id fallback.
export async function initDeviceId() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const { Device } = await import('@capacitor/device');
      const { identifier } = await Device.getId();
      if (identifier) {
        const hardwareId = `NG-${String(identifier).toUpperCase()}`;
        if (getDeviceId() !== hardwareId) setDeviceId(hardwareId);
        return hardwareId;
      }
    }
  } catch (err) {
    console.warn('[DeviceStore] hardware device id unavailable:', err?.message || err);
  }
  const existing = getDeviceId();
  if (existing) return existing;
  const generated = `NG-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  return setDeviceId(generated);
}

export function getPendingSchemaSync() {
  return readJson(PENDING_SCHEMA_SYNC_KEY, {});
}

export function markPendingSchemaSync(key, value = true) {
  const next = {
    ...getPendingSchemaSync(),
    [key]: value,
  };
  return writeJson(PENDING_SCHEMA_SYNC_KEY, next);
}

export function clearPendingSchemaSync(key) {
  const current = { ...getPendingSchemaSync() };
  delete current[key];
  return writeJson(PENDING_SCHEMA_SYNC_KEY, current);
}

export function buildLocalDataExport() {
  const exportKeys = [
    LOOKUP_KEY,
    PATROL_CONFIG_KEY,
    NFC_SCANS_KEY,
    SHIFT_SESSION_KEY,
    PRECLEARED_PEDESTRIANS_KEY,
    BLACKLISTED_VEHICLES_KEY,
    REPORT_EMAIL_SETTINGS_KEY,
    LAST_SYNC_KEY,
    DEVICE_ID_KEY,
    SITE_SETTINGS_KEY,
    DEVICE_SETTINGS_KEY,
    GENERAL_GUARD_SEEDED_KEY,
    PENDING_SCHEMA_SYNC_KEY,
    CACHED_PATROLS_KEY,
    'nightguard_offline_queue',
    'cached_pedestrians',
    'cached_vehicles',
    'cached_incidents',
    'cached_ob_entries',
  ];

  return exportKeys.reduce((acc, key) => {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      try {
        acc[key] = JSON.parse(raw);
      } catch {
        acc[key] = raw;
      }
    }
    return acc;
  }, {
    exported_at: new Date().toISOString(),
    location_name: getLocationName(),
    device_id: getDeviceId(),
    guard: {
      id: GENERAL_GUARD_ID,
      name: GENERAL_GUARD.full_name,
      mode: 'single_general_guard',
    },
  });
}
