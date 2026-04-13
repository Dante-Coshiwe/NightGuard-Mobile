const LOOKUP_KEY = 'nightguard_lookup_data';
const PATROL_CONFIG_KEY = 'nightguard_patrol_config';
const NFC_SCANS_KEY = 'nightguard_nfc_scans';
const SHIFT_SESSION_KEY = 'nightguard_shift_session';
const QUICK_SWITCH_KEY = 'nightguard_quick_switch_enabled';
const CACHED_GUARDS_KEY = 'nightguard_cached_guards';

export const DEFAULT_LOOKUP_DATA = {
  shiftOptions: ['Day Shift', 'Night Shift'],
  pedestrianTypes: ['Visitor', 'Contractor', 'Resident', 'Delivery'],
  vehicleTypes: ['Visitor', 'Contractor', 'Delivery', 'Service'],
  units: ['Reception', 'Block A', 'Block B'],
  incidentTypes: ['Suspicious Activity', 'Damage', 'Medical', 'Access Control'],
};

export const DEFAULT_PATROL_CONFIG = {
  patrolScheduleEnabled: true,
  patrolIntervalMinutes: 60,
  minimumTagCount: 3,
  checkpoints: [
    { id: 'cp-1', name: 'Main Gate', tag_uid: 'NG-MAIN-001', zone: 'Perimeter', required: true },
    { id: 'cp-2', name: 'Parking Gate', tag_uid: 'NG-PARK-002', zone: 'Parking', required: true },
    { id: 'cp-3', name: 'Reception Door', tag_uid: 'NG-REC-003', zone: 'Lobby', required: true },
  ],
};

function readJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}

export function getLookupData() {
  return {
    ...DEFAULT_LOOKUP_DATA,
    ...readJson(LOOKUP_KEY, {}),
  };
}

export function saveLookupData(data) {
  return writeJson(LOOKUP_KEY, data);
}

export function getPatrolConfig() {
  const stored = readJson(PATROL_CONFIG_KEY, {});
  return {
    ...DEFAULT_PATROL_CONFIG,
    ...stored,
    checkpoints: stored.checkpoints?.length ? stored.checkpoints : DEFAULT_PATROL_CONFIG.checkpoints,
  };
}

export function savePatrolConfig(data) {
  return writeJson(PATROL_CONFIG_KEY, data);
}

export function getNfcScans() {
  return readJson(NFC_SCANS_KEY, []);
}

export function saveNfcScans(scans) {
  return writeJson(NFC_SCANS_KEY, scans);
}

export function appendNfcScan(scan) {
  const existing = getNfcScans();
  const updated = [scan, ...existing];
  saveNfcScans(updated);
  return updated;
}

export function getShiftSession() {
  return readJson(SHIFT_SESSION_KEY, null);
}

export function saveShiftSession(session) {
  return writeJson(SHIFT_SESSION_KEY, session);
}

export function clearShiftSession() {
  localStorage.removeItem(SHIFT_SESSION_KEY);
}

export function getQuickSwitchEnabled() {
  const stored = localStorage.getItem(QUICK_SWITCH_KEY);
  return stored === null ? true : stored === 'true';
}

export function saveQuickSwitchEnabled(enabled) {
  localStorage.setItem(QUICK_SWITCH_KEY, String(Boolean(enabled)));
  return enabled;
}

export function getCachedGuards() {
  return readJson(CACHED_GUARDS_KEY, []);
}

export function saveCachedGuards(guards) {
  return writeJson(CACHED_GUARDS_KEY, guards);
}
