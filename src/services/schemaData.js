import { supabase } from '../lib/supabase';
import { getBoundSiteIdSync } from '../lib/siteResolver';
import {
  DEFAULT_LOOKUP_DATA,
  DEFAULT_PATROL_CONFIG,
  clearPendingSchemaSync,
  GENERAL_GUARD,
  getCachedSiteSettings,
  getDeviceId,
  setDeviceId,
  getDeviceSettings,
  getLookupData,
  getPatrolConfig,
  getPendingSchemaSync,
  getNfcScans,
  getReportEmailSetting,
  getReportEmailSettings,
  markPendingSchemaSync,
  saveLastSyncAt,
  saveCachedGuards,
  saveCachedPedestrians,
  saveCachedVehicles,
  saveDeviceSettings,
  saveLookupData,
  savePatrolConfig,
  saveQuickSwitchEnabled,
  saveReportEmailSettings,
} from '../lib/deviceStore';
import { setCachedIncidents, setCachedObEntries } from '../lib/reportCache';
import { isValidCoordinate } from '../lib/geo';

function getSupabaseErrorMessage(error) {
  return String(error?.message || error?.details || error?.hint || '').trim();
}

function shouldFallbackToLocal(error) {
  const message = getSupabaseErrorMessage(error).toLowerCase();
  return (
    message.includes('row-level security') ||
    message.includes('violates row-level security') ||
    message.includes('schema cache') ||
    message.includes('could not find the') ||
    message.includes('permission denied') ||
    message.includes('not found in the schema cache') ||
    // Network reachability, including the 12s client deadline in lib/supabase.js.
    // A device that cannot reach the server has cached data that is still good;
    // throwing here would surface an error where the cache is the right answer.
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('aborted') ||
    message.includes('abort') ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
}

function markPendingAndReturn(key, value) {
  markPendingSchemaSync(key, true);
  return { ...value, _offline: true };
}

function markPendingReportSchedule(reportType, value) {
  markPendingSchemaSync('reportSchedules', {
    ...(getPendingSchemaSync().reportSchedules || {}),
    [reportType]: true,
  });
  return { ...value, _offline: true };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function getSiteId(siteSettings = getCachedSiteSettings()) {
  return siteSettings?.id || getBoundSiteIdSync() || null;
}

export function getCurrentDeviceRecord(siteSettings = getCachedSiteSettings()) {
  const devices = Array.isArray(siteSettings?.devices) ? siteSettings.devices : [];
  const localDeviceId = getDeviceId();

  if (!localDeviceId) return null;

  // Strict match only — NEVER fall back to devices[0]
  return devices.find((device) => String(device.device_id) === String(localDeviceId)) || null;
}

function withNonEmptyArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function mapLookupRowToLocal(row = {}) {
  return {
    shiftOptions: Array.isArray(row.shift_options) ? row.shift_options : DEFAULT_LOOKUP_DATA.shiftOptions,
    pedestrianTypes: Array.isArray(row.pedestrian_types) ? row.pedestrian_types : DEFAULT_LOOKUP_DATA.pedestrianTypes,
    vehicleTypes: Array.isArray(row.vehicle_types) ? row.vehicle_types : DEFAULT_LOOKUP_DATA.vehicleTypes,
    units: Array.isArray(row.units) ? row.units : DEFAULT_LOOKUP_DATA.units,
    incidentTypes: Array.isArray(row.incident_types) ? row.incident_types : DEFAULT_LOOKUP_DATA.incidentTypes,
  };
}

function buildLookupRow(siteId, data) {
  return {
    site_id: siteId,
    shift_options: withNonEmptyArray(data.shiftOptions, DEFAULT_LOOKUP_DATA.shiftOptions),
    pedestrian_types: withNonEmptyArray(data.pedestrianTypes, DEFAULT_LOOKUP_DATA.pedestrianTypes),
    vehicle_types: withNonEmptyArray(data.vehicleTypes, DEFAULT_LOOKUP_DATA.vehicleTypes),
    units: withNonEmptyArray(data.units, DEFAULT_LOOKUP_DATA.units),
    incident_types: withNonEmptyArray(data.incidentTypes, DEFAULT_LOOKUP_DATA.incidentTypes),
    updated_at: new Date().toISOString(),
  };
}

function mapPatrolConfig(scheduleRow, checkpoints) {
  const savedCheckpoints = Array.isArray(checkpoints) && checkpoints.length
    ? checkpoints.map((checkpoint, index) => ({
      id: checkpoint.id,
      name: checkpoint.name || '',
      tag_uid: checkpoint.tag_uid || '',
      zone: checkpoint.zone || '',
      checkpoint_order: checkpoint.checkpoint_order ?? index + 1,
      required: checkpoint.required !== false,
      status: checkpoint.status || 'pending',
      latitude: isValidCoordinate(checkpoint.latitude, checkpoint.longitude) ? Number(checkpoint.latitude) : null,
      longitude: isValidCoordinate(checkpoint.latitude, checkpoint.longitude) ? Number(checkpoint.longitude) : null,
    }))
    : DEFAULT_PATROL_CONFIG.checkpoints;

  return {
    ...DEFAULT_PATROL_CONFIG,
    patrolScheduleEnabled: scheduleRow?.patrol_interval_minutes !== 0,
    patrolTimes: Array.isArray(scheduleRow?.patrol_times) && scheduleRow.patrol_times.length
      ? scheduleRow.patrol_times
      : DEFAULT_PATROL_CONFIG.patrolTimes,
    patrolIntervalMinutes: scheduleRow?.patrol_interval_minutes || DEFAULT_PATROL_CONFIG.patrolIntervalMinutes,
    minimumTagCount: scheduleRow?.required_nfc_tags_count || DEFAULT_PATROL_CONFIG.minimumTagCount,
    checkpoints: savedCheckpoints,
  };
}

function normalisePatrolTimes(times = []) {
  return Array.from(new Set(
    (Array.isArray(times) ? times : [])
      .map((time) => String(time || '').trim())
      .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
  )).sort();
}

function validatePatrolConfig(localConfig = {}) {
  const patrolTimes = normalisePatrolTimes(localConfig.patrolTimes);
  if (localConfig.patrolScheduleEnabled !== false && patrolTimes.length === 0) {
    throw new Error('Add at least one patrol time in HH:mm format.');
  }

  const checkpoints = Array.isArray(localConfig.checkpoints) ? localConfig.checkpoints : [];
  checkpoints.forEach((checkpoint, index) => {
    const latEntered = checkpoint.latitude !== null && checkpoint.latitude !== undefined && String(checkpoint.latitude).trim() !== '';
    const lngEntered = checkpoint.longitude !== null && checkpoint.longitude !== undefined && String(checkpoint.longitude).trim() !== '';
    const hasCoordinates = isValidCoordinate(checkpoint.latitude, checkpoint.longitude);
    const hasAnyValue = checkpoint.name?.trim() || checkpoint.tag_uid?.trim() || checkpoint.zone?.trim() || latEntered || lngEntered;
    if (!hasAnyValue) return;
    if (!checkpoint.name?.trim()) throw new Error(`Checkpoint ${index + 1}: name is required.`);
    // A half-entered or out-of-range pin would never match a geofence, silently denying the
    // guard credit — reject it at save time so the point is either a valid pin or none at all.
    if ((latEntered || lngEntered) && !hasCoordinates) {
      throw new Error(`Checkpoint ${index + 1}: GPS pin is invalid. Latitude must be between -90 and 90 and longitude between -180 and 180.`);
    }
    if (!checkpoint.tag_uid?.trim() && !hasCoordinates) {
      throw new Error(`Checkpoint ${index + 1}: add an NFC tag or drop a GPS pin.`);
    }
    if (!Number(checkpoint.checkpoint_order || index + 1)) throw new Error(`Checkpoint ${index + 1}: order is required.`);
  });
}

function buildReportSchedulePayload(siteId, reportType, settings) {
  return {
    site_id: siteId,
    report_type: reportType,
    send_time_utc: settings.time || '06:00',
    subject_line: settings.subject || '',
    recipient_emails: String(settings.recipients || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    is_active: settings.enabled !== false,
  };
}

async function writeCache(key, value) {
  //  Type validation to prevent TypeError on array methods
  if (key === 'cached_pedestrians') {
    const validated = Array.isArray(value) ? value : [];
    return saveCachedPedestrians(validated);
  }
  if (key === 'cached_vehicles') {
    const validated = Array.isArray(value) ? value : [];
    return saveCachedVehicles(validated);
  }
  if (key === 'cached_incidents') {
    const validated = Array.isArray(value) ? value : [];
    await setCachedIncidents(validated);
    return validated;
  }
  if (key === 'cached_ob_entries') {
    const validated = Array.isArray(value) ? value : [];
    await setCachedObEntries(validated);
    return validated;
  }
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}

function mapPedestrianCacheRows(rows = []) {
  if (!Array.isArray(rows)) {
    console.warn('[SchemaData] mapPedestrianCacheRows expected array, got:', typeof rows);
    return [];
  }
  return rows.map((p) => ({
    id: p?.id,
    name: p?.full_name,
    contact: p?.contact_number,
    visitorType: p?.purpose_of_visit,
    unitVisiting: p?.visiting_unit,
    hostName: p?.host_name,
    photoUrl: p?.picture_url,
    entryTime: p?.entry_time,
    exitTime: p?.exit_time,
    hasLeft: Boolean(p?.exit_time),
    isPrecleared: Boolean(p?.is_precleared),
    _offline: false,
    _pendingExit: false,
  }));
}

function mapVehicleCacheRows(rows = []) {
  if (!Array.isArray(rows)) {
    console.warn('[SchemaData] mapVehicleCacheRows expected array, got:', typeof rows);
    return [];
  }
  return rows.map((v) => ({
    id: v?.id,
    licensePlate: v?.license_plate,
    makeModel: v?.vehicle_make || v?.vehicle_type,
    driverName: v?.driver_name,
    colour: v?.vehicle_color,
    contact: v?.driver_contact || v?.contact_number,
    personVisiting: v?.visiting_unit,
    photoUrl: v?.picture_url,
    visitorType: v?.visitor_type,
    enteredAt: v?.entered_at,
    exitedAt: v?.exited_at,
    hasLeft: Boolean(v?.exited_at),
    _offline: false,
    _pendingExit: false,
  }));
}

function mapGuardRows(rows = []) {
  return saveCachedGuards([GENERAL_GUARD]);
}

export async function loadSiteLookupData(siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  const cachedLookupData = getLookupData();
  if (!siteId || !navigator.onLine) {
    return cachedLookupData;
  }

  console.log('[Lookup] online:', navigator.onLine, 'siteId:', siteId);
  // No unique constraint on site_id — read the latest row and tolerate duplicates
  // instead of using .maybeSingle() (which throws when more than one row exists).
  const { data: lookupRows, error } = await supabase
    .from('site_lookup_data')
    .select('*')
    .eq('site_id', siteId)
    .order('updated_at', { ascending: false })
    .limit(1);
  const data = Array.isArray(lookupRows) ? lookupRows[0] : lookupRows;
  console.log('[Lookup] supabase row:', data, 'error:', error);

  if (error) {
    if (shouldFallbackToLocal(error)) {
      return cachedLookupData;
    }
    throw new Error(error.message);
  }

  const hasRemoteLookupData = Boolean(
    data &&
    (
      (Array.isArray(data.shift_options) && data.shift_options.length) ||
      (Array.isArray(data.pedestrian_types) && data.pedestrian_types.length) ||
      (Array.isArray(data.vehicle_types) && data.vehicle_types.length) ||
      (Array.isArray(data.units) && data.units.length) ||
      (Array.isArray(data.incident_types) && data.incident_types.length)
    )
  );

  const localData = hasRemoteLookupData
    ? mapLookupRowToLocal(data)
    : cachedLookupData;
  saveLookupData(localData);

  if (!data) {
    try {
      await saveSiteLookupData(localData, siteSettings);
    } catch {
      return localData;
    }
  }

  return localData;
}

export async function saveSiteLookupData(localData, siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  saveLookupData(localData);

  if (!siteId || !navigator.onLine) {
    markPendingSchemaSync('lookupData');
    return { ...localData, _offline: true };
  }

  const payload = buildLookupRow(siteId, localData);

  // site_lookup_data has PK `id` and no unique constraint on `site_id`, so upsert(onConflict:
  // 'site_id') fails with Postgres 42P10. Select the existing row then update by id, else insert
  // — matching saveDeviceConfiguration / saveReportSchedule below.
  const { data: existingRows, error: selectError } = await supabase
    .from('site_lookup_data')
    .select('id')
    .eq('site_id', siteId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (selectError) {
    if (shouldFallbackToLocal(selectError)) {
      return markPendingAndReturn('lookupData', localData);
    }
    markPendingSchemaSync('lookupData');
    throw new Error(selectError.message);
  }

  const existingId = existingRows?.[0]?.id;
  const { error } = existingId
    ? await supabase.from('site_lookup_data').update(payload).eq('id', existingId)
    : await supabase.from('site_lookup_data').insert(payload);

  if (error) {
    if (shouldFallbackToLocal(error)) {
      return markPendingAndReturn('lookupData', localData);
    }
    markPendingSchemaSync('lookupData');
    throw new Error(error.message);
  }

  clearPendingSchemaSync('lookupData');
  return localData;
}

export async function loadPatrolConfiguration(siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  const cachedPatrolConfig = getPatrolConfig();
  if (!siteId || !navigator.onLine) {
    return cachedPatrolConfig;
  }

  const [{ data: scheduleRow, error: scheduleError }, { data: checkpoints, error: checkpointsError }] = await Promise.all([
    supabase.from('site_patrol_schedules').select('*').eq('site_id', siteId).maybeSingle(),
    supabase.from('patrol_checkpoints').select('*').eq('site_id', siteId).order('checkpoint_order', { ascending: true }),
  ]);

  if (scheduleError && !shouldFallbackToLocal(scheduleError)) throw new Error(scheduleError.message);
  if (checkpointsError && !shouldFallbackToLocal(checkpointsError)) throw new Error(checkpointsError.message);

  // The stored config is stamped with the site it was loaded for. A device that moved between
  // sites — or whose binding resolved after the config was first cached — must not carry the
  // previous site's patrol points across. Without this, an empty new site got seeded with the OLD
  // site's layout below, copying one client's checkpoint names and GPS pins into another's.
  const configSiteId = cachedPatrolConfig.site_id || null;
  const belongsToThisSite = !configSiteId || String(configSiteId) === String(siteId);
  const localBaseline = belongsToThisSite ? cachedPatrolConfig : { ...DEFAULT_PATROL_CONFIG };
  if (!belongsToThisSite) {
    console.warn(`[PatrolConfig] cached config belongs to site ${configSiteId}, not ${siteId} — discarding it`);
  }

  const hasRemoteSchedule = Boolean(scheduleRow);
  const hasRemoteCheckpoints = Array.isArray(checkpoints) && checkpoints.length > 0;
  const localConfig = (hasRemoteSchedule || hasRemoteCheckpoints)
    ? mapPatrolConfig(scheduleRow, checkpoints)
    : localBaseline;
  savePatrolConfig({ ...localConfig, site_id: siteId });

  if (!scheduleRow || !Array.isArray(checkpoints) || checkpoints.length === 0) {
    try {
      await savePatrolConfiguration(localConfig, siteSettings);
    } catch {
      return localConfig;
    }
  }

  return localConfig;
}

export async function savePatrolConfiguration(localConfig, siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  validatePatrolConfig(localConfig);
  const normalisedConfig = {
    ...localConfig,
    patrolTimes: normalisePatrolTimes(localConfig.patrolTimes),
    site_id: siteId || localConfig.site_id || null,
  };
  savePatrolConfig(normalisedConfig);

  if (!siteId || !navigator.onLine) {
    markPendingSchemaSync('patrolConfig');
    return { ...normalisedConfig, _offline: true };
  }

  const schedulePayload = {
    site_id: siteId,
    patrol_interval_minutes: normalisedConfig.patrolScheduleEnabled === false ? 0 : Number(normalisedConfig.patrolIntervalMinutes || DEFAULT_PATROL_CONFIG.patrolIntervalMinutes),
    patrol_times: normalisedConfig.patrolScheduleEnabled === false ? [] : normalisedConfig.patrolTimes,
    required_nfc_tags_count: Number(normalisedConfig.minimumTagCount || DEFAULT_PATROL_CONFIG.minimumTagCount),
    updated_at: new Date().toISOString(),
  };

  // Select-then-update/insert keyed on site_id (rather than upsert(onConflict:'site_id')) so this
  // works whether or not site_patrol_schedules has a unique constraint on site_id, and without
  // assuming the table has a separate `id` column.
  const { data: existingSchedules, error: scheduleSelectError } = await supabase
    .from('site_patrol_schedules')
    .select('site_id')
    .eq('site_id', siteId)
    .limit(1);

  if (scheduleSelectError) {
    if (shouldFallbackToLocal(scheduleSelectError)) {
      return markPendingAndReturn('patrolConfig', normalisedConfig);
    }
    markPendingSchemaSync('patrolConfig');
    throw new Error(scheduleSelectError.message);
  }

  const scheduleExists = Array.isArray(existingSchedules) && existingSchedules.length > 0;
  const { error: scheduleError } = scheduleExists
    ? await supabase.from('site_patrol_schedules').update(schedulePayload).eq('site_id', siteId)
    : await supabase.from('site_patrol_schedules').insert(schedulePayload);

  if (scheduleError) {
    if (shouldFallbackToLocal(scheduleError)) {
      return markPendingAndReturn('patrolConfig', normalisedConfig);
    }
    markPendingSchemaSync('patrolConfig');
    throw new Error(scheduleError.message);
  }

  const currentCheckpoints = Array.isArray(normalisedConfig.checkpoints) ? normalisedConfig.checkpoints : [];
  const syncedIds = currentCheckpoints.filter((item) => isUuid(item.id)).map((item) => item.id);

  const { data: existingRows, error: existingError } = await supabase
    .from('patrol_checkpoints')
    .select('id')
    .eq('site_id', siteId);

  if (existingError) {
    if (shouldFallbackToLocal(existingError)) {
      return markPendingAndReturn('patrolConfig', normalisedConfig);
    }
    markPendingSchemaSync('patrolConfig');
    throw new Error(existingError.message);
  }

  const removableIds = (existingRows || [])
    .map((row) => row.id)
    .filter((id) => !syncedIds.includes(id));

  if (removableIds.length) {
    // Unlink recorded scans first: nfc_scans_checkpoint_id_fkey otherwise blocks the delete,
    // which used to abort the ENTIRE config save for any site with scan history.
    await supabase.from('nfc_scans').update({ checkpoint_id: null }).in('checkpoint_id', removableIds);

    const { error: deleteError } = await supabase.from('patrol_checkpoints').delete().in('id', removableIds);
    if (deleteError) {
      if (shouldFallbackToLocal(deleteError)) {
        return markPendingAndReturn('patrolConfig', normalisedConfig);
      }
      // A still-referenced checkpoint (FK 23503 — e.g. the scan unlink was denied by RLS)
      // must not abort the whole save; leave the orphaned row behind and keep going.
      if (deleteError.code === '23503') {
        console.warn('[PatrolConfig] Could not delete referenced checkpoints; leaving them in place:', deleteError.message);
      } else {
        markPendingSchemaSync('patrolConfig');
        throw new Error(deleteError.message);
      }
    }
  }

  // tag_uid has a UNIQUE constraint, so the same non-empty tag must never appear twice
  // in one save batch — that alone triggers patrol_checkpoints_tag_uid_key. Keep the first
  // occurrence of each tag; blank out any later duplicate so it saves as a GPS-only point
  // instead of aborting the whole save.
  const seenTagUids = new Set();
  const checkpointRows = currentCheckpoints
    .filter((checkpoint) => {
      const hasCoordinates = isValidCoordinate(checkpoint.latitude, checkpoint.longitude);
      return checkpoint.name?.trim() || checkpoint.tag_uid?.trim() || hasCoordinates;
    })
    .map((checkpoint, index) => {
      let tagUid = checkpoint.tag_uid?.trim()?.toUpperCase() || null;
      if (tagUid) {
        if (seenTagUids.has(tagUid)) {
          console.warn(`[PatrolConfig] Duplicate checkpoint tag_uid "${tagUid}" — dropping it from checkpoint ${index + 1} to avoid a unique-constraint violation.`);
          tagUid = null;
        } else {
          seenTagUids.add(tagUid);
        }
      }
      return {
        ...(isUuid(checkpoint.id) ? { id: checkpoint.id } : {}),
        site_id: siteId,
        name: checkpoint.name?.trim() || `Checkpoint ${index + 1}`,
        checkpoint_order: Number(checkpoint.checkpoint_order || index + 1),
        tag_uid: tagUid,
        zone: checkpoint.zone?.trim() || '',
        required: checkpoint.required !== false,
        status: checkpoint.status || 'pending',
        latitude: isValidCoordinate(checkpoint.latitude, checkpoint.longitude) ? Number(checkpoint.latitude) : null,
        longitude: isValidCoordinate(checkpoint.latitude, checkpoint.longitude) ? Number(checkpoint.longitude) : null,
      };
    });

  if (checkpointRows.length) {
    const existingCheckpointRows = checkpointRows.filter((row) => isUuid(row.id));
    const newCheckpointRows = checkpointRows.filter((row) => !isUuid(row.id));
    let savedRows = [];

    if (existingCheckpointRows.length) {
      const { data: updatedRows, error: checkpointError } = await supabase
        .from('patrol_checkpoints')
        .upsert(existingCheckpointRows, { onConflict: 'id' })
        .select('*');

      if (checkpointError) {
        if (shouldFallbackToLocal(checkpointError)) {
          return markPendingAndReturn('patrolConfig', normalisedConfig);
        }
        markPendingSchemaSync('patrolConfig');
        throw new Error(checkpointError.message);
      }

      savedRows = [...savedRows, ...(updatedRows || [])];
    }

    if (newCheckpointRows.length) {
      let { data: insertedRows, error: insertError } = await supabase
        .from('patrol_checkpoints')
        .insert(newCheckpointRows)
        .select('*');

      // If a tag_uid still collides with a row already in the table (e.g. another
      // site holding it under the legacy global unique constraint), don't lose the
      // whole save — retry once with every tag_uid blanked so the points persist as
      // GPS-only. The guard can re-link tags afterwards.
      if (insertError && /tag_uid/i.test(insertError.message || '')) {
        console.warn('[PatrolConfig] tag_uid collision on insert; retrying checkpoints as GPS-only.', insertError.message);
        const gpsOnlyRows = newCheckpointRows.map((row) => ({ ...row, tag_uid: null }));
        ({ data: insertedRows, error: insertError } = await supabase
          .from('patrol_checkpoints')
          .insert(gpsOnlyRows)
          .select('*'));
      }

      if (insertError) {
        if (shouldFallbackToLocal(insertError)) {
          return markPendingAndReturn('patrolConfig', normalisedConfig);
        }
        markPendingSchemaSync('patrolConfig');
        throw new Error(insertError.message);
      }

      savedRows = [...savedRows, ...(insertedRows || [])];
    }

    if (savedRows.length) {
      const mapped = mapPatrolConfig(schedulePayload, savedRows);
      savePatrolConfig(mapped);
    }
  }

  clearPendingSchemaSync('patrolConfig');
  return getPatrolConfig();
}

function mapDeviceSettingsRecord(record, deviceRecord) {
  return {
    id: record?.id || null,
    deviceRecordId: record?.device_id || deviceRecord?.id || null,
    allowQuickGuardSwitch: false,
    autoCloseShiftAtMidnight: Boolean(record?.auto_close_shift_at_midnight),
    autoExitVehicle: Boolean(record?.auto_exit_vehicle),
    autoExitPedestrian: Boolean(record?.auto_exit_pedestrian),
    uploadVehicleImage: Boolean(record?.upload_vehicle_image),
    uploadPedestrianImage: Boolean(record?.upload_pedestrian_image),
    deviceDescription: deviceRecord?.device_description || '',
  };
}

export async function loadDeviceConfiguration(siteSettings = getCachedSiteSettings()) {
  if (!navigator.onLine) return getDeviceSettings();

  const siteId = getSiteId(siteSettings);
  if (!siteId) return getDeviceSettings();

  const { data, error } = await supabase
    .from('device_settings')
    .select('*')
    .eq('site_id', siteId);

  if (error) {
    if (shouldFallbackToLocal(error)) return getDeviceSettings();
    throw new Error(error.message);
  }

  // ---- AUTO-BIND LOGIC ----
  // If local device ID doesn't match any device in the site,
  // and admin has only registered one device, bind to it automatically.
  const devices = Array.isArray(siteSettings?.devices) ? siteSettings.devices : [];
  let deviceRecord = getCurrentDeviceRecord(siteSettings);

  if (!deviceRecord && devices.length === 1) {
    // Plug-and-play: bind this physical device to the only registered device record
    setDeviceId(devices[0].device_id);
    deviceRecord = devices[0];
    console.info(`[NightGuard] Auto-bound to device: ${devices[0].device_id}`);
  } else if (!deviceRecord && devices.length > 1) {
    // Multiple devices registered — can't auto-bind, needs explicit pairing
    return getDeviceSettings();
  }

  if (!deviceRecord?.id) {
    return getDeviceSettings();
  }

  const selected = (data || []).find((row) => row.device_id === deviceRecord.id) || null;
  const localSettings = {
    ...getDeviceSettings(),
    ...mapDeviceSettingsRecord(selected, deviceRecord),
  };

  saveDeviceSettings(localSettings);
  saveQuickSwitchEnabled(false);

  if (!selected) {
    try {
      await saveDeviceConfiguration(localSettings, siteSettings);
    } catch {
      return localSettings;
    }
  }

  return localSettings;
}

export async function saveDeviceConfiguration(localSettings, siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  const deviceRecord = getCurrentDeviceRecord(siteSettings);
  saveDeviceSettings(localSettings);
  saveQuickSwitchEnabled(false);

  if (!siteId || !navigator.onLine) {
    markPendingSchemaSync('deviceSettings');
    return { ...localSettings, _offline: true };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('device_settings')
    .select('*')
    .eq('site_id', siteId);

  if (existingError) {
    if (shouldFallbackToLocal(existingError)) {
      return markPendingAndReturn('deviceSettings', localSettings);
    }
    markPendingSchemaSync('deviceSettings');
    throw new Error(existingError.message);
  }

  const existing = (existingRows || []).find((row) => row.device_id === deviceRecord?.id) || existingRows?.[0] || null;
  const payload = {
    ...(existing?.id ? { id: existing.id } : {}),
    site_id: siteId,
    device_id: deviceRecord?.id || null,
    allow_quick_guard_switch: false,
    auto_close_shift_at_midnight: Boolean(localSettings.autoCloseShiftAtMidnight),
    auto_exit_vehicle: Boolean(localSettings.autoExitVehicle),
    auto_exit_pedestrian: Boolean(localSettings.autoExitPedestrian),
    upload_vehicle_image: Boolean(localSettings.uploadVehicleImage),
    upload_pedestrian_image: Boolean(localSettings.uploadPedestrianImage),
    updated_at: new Date().toISOString(),
  };

  const query = existing?.id
    ? supabase.from('device_settings').update(payload).eq('id', existing.id)
    : supabase.from('device_settings').insert(payload);

  const { error } = await query;
  if (error) {
    if (shouldFallbackToLocal(error)) {
      return markPendingAndReturn('deviceSettings', localSettings);
    }
    markPendingSchemaSync('deviceSettings');
    throw new Error(error.message);
  }

  if (deviceRecord?.id) {
    const { error: deviceError } = await supabase
      .from('devices')
      .update({
        device_id: getDeviceId(),
        device_description: localSettings.deviceDescription || '',
        latest_sync_update: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deviceRecord.id);

    if (deviceError) {
      if (shouldFallbackToLocal(deviceError)) {
        return markPendingAndReturn('deviceSettings', localSettings);
      }
      markPendingSchemaSync('deviceSettings');
      throw new Error(deviceError.message);
    }
  }

  clearPendingSchemaSync('deviceSettings');
  return localSettings;
}

export async function loadReportSchedules(siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  if (!siteId || !navigator.onLine) {
    return getReportEmailSettings();
  }

  const { data, error } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('site_id', siteId);

  if (error) {
    if (shouldFallbackToLocal(error)) {
      return getReportEmailSettings();
    }
    throw new Error(error.message);
  }

  const mapped = (data || []).reduce((acc, row) => {
    acc[row.report_type] = {
      enabled: row.is_active !== false,
      time: row.send_time_utc || '06:00',
      subject: row.subject_line || '',
      recipients: Array.isArray(row.recipient_emails) ? row.recipient_emails.join(', ') : '',
    };
    return acc;
  }, {});

  saveReportEmailSettings({
    ...getReportEmailSettings(),
    ...mapped,
  });

  return getReportEmailSettings();
}

export async function saveReportSchedule(reportType, settings, siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  const localSchedules = {
    ...getReportEmailSettings(),
    [reportType]: settings,
  };

  saveReportEmailSettings(localSchedules);

  if (!siteId || !navigator.onLine) {
    markPendingSchemaSync('reportSchedules', {
      ...(getPendingSchemaSync().reportSchedules || {}),
      [reportType]: true,
    });
    return { ...settings, _offline: true };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('site_id', siteId)
    .eq('report_type', reportType);

  if (existingError) {
    if (shouldFallbackToLocal(existingError)) {
      return markPendingReportSchedule(reportType, settings);
    }
    markPendingSchemaSync('reportSchedules', {
      ...(getPendingSchemaSync().reportSchedules || {}),
      [reportType]: true,
    });
    throw new Error(existingError.message);
  }

  const existing = existingRows?.[0] || null;
  const payload = {
    ...(existing?.id ? { id: existing.id } : {}),
    ...buildReportSchedulePayload(siteId, reportType, settings),
  };

  const query = existing?.id
    ? supabase.from('report_schedules').update(payload).eq('id', existing.id)
    : supabase.from('report_schedules').insert(payload);

  const { error } = await query;
  if (error) {
    if (shouldFallbackToLocal(error)) {
      return markPendingReportSchedule(reportType, settings);
    }
    markPendingSchemaSync('reportSchedules', {
      ...(getPendingSchemaSync().reportSchedules || {}),
      [reportType]: true,
    });
    throw new Error(error.message);
  }

  const pending = { ...(getPendingSchemaSync().reportSchedules || {}) };
  delete pending[reportType];
  if (Object.keys(pending).length) {
    markPendingSchemaSync('reportSchedules', pending);
  } else {
    clearPendingSchemaSync('reportSchedules');
  }

  return settings;
}

export async function syncPendingSchemaData(siteSettings = getCachedSiteSettings()) {
  if (!navigator.onLine) {
    return { syncedCount: 0 };
  }

  const pending = getPendingSchemaSync();
  let syncedCount = 0;
  const startedAt = new Date().toISOString();

  if (pending.lookupData) {
    try {
      const result = await saveSiteLookupData(getLookupData(), siteSettings);
      if (!result?._offline) syncedCount += 1;
    } catch {
      // Leave pending state in place and continue other sync tasks.
    }
  }

  if (pending.patrolConfig) {
    try {
      const result = await savePatrolConfiguration(getPatrolConfig(), siteSettings);
      if (!result?._offline) syncedCount += 1;
    } catch {
      // Leave pending state in place and continue other sync tasks.
    }
  }

  if (pending.deviceSettings) {
    try {
      const result = await saveDeviceConfiguration(getDeviceSettings(), siteSettings);
      if (!result?._offline) syncedCount += 1;
    } catch {
      // Leave pending state in place and continue other sync tasks.
    }
  }

  if (pending.reportSchedules && typeof pending.reportSchedules === 'object') {
    const reportTypes = Object.keys(pending.reportSchedules);
    for (const reportType of reportTypes) {
      try {
        const result = await saveReportSchedule(reportType, getReportEmailSetting(reportType), siteSettings);
        if (!result?._offline) syncedCount += 1;
      } catch {
        // Leave pending state in place and continue.
      }
    }
  }

  if (syncedCount > 0) {
    const completedAt = new Date().toISOString();
    saveLastSyncAt(completedAt);
    await recordDeviceSyncLog({
      syncType: 'schema_sync',
      syncStatus: 'completed',
      recordsSynced: syncedCount,
      startedAt,
      completedAt,
    }, siteSettings).catch(() => null);
    window.dispatchEvent(new Event('nightguard_sync_complete'));
  }

  return { syncedCount };
}

export async function refreshOperationalCachesFromDatabase(siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  if (!navigator.onLine || !siteId) {
    return { refreshed: false };
  }

  const [
    pedestriansResult,
    vehiclesResult,
    incidentsResult,
    obEntriesResult,
    scansResult,
  ] = await Promise.all([
    supabase.from('pedestrians').select('*').eq('site_id', siteId).order('entry_time', { ascending: false }),
    supabase.from('vehicles').select('*').eq('site_id', siteId).order('entered_at', { ascending: false }),
    supabase.from('incidents').select('*').eq('site_id', siteId).order('reported_at', { ascending: false }),
    supabase.from('ob_entries').select('*').eq('site_id', siteId).order('captured_timestamp', { ascending: false }),
    supabase.from('nfc_scans').select('*').eq('site_id', siteId).order('scanned_at', { ascending: false }),
  ]);

  const results = [pedestriansResult, vehiclesResult, incidentsResult, obEntriesResult, scansResult];
  const failed = results.find((result) => result.error && !shouldFallbackToLocal(result.error));
  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  await writeCache('cached_pedestrians', mapPedestrianCacheRows(pedestriansResult.data || []));
  await writeCache('cached_vehicles', mapVehicleCacheRows(vehiclesResult.data || []));
  await writeCache('cached_incidents', incidentsResult.data || []);
  await writeCache('cached_ob_entries', obEntriesResult.data || []);
  // Merge, don't clobber. The server snapshot is filtered by site_id and only
  // contains rows the server actually persisted, so a blind overwrite would drop
  // any local scan that is still queued (offline / no Supabase session) or that
  // has not yet round-tripped. That is what made just-logged GPS check-ins appear
  // and then vanish on the next sync. We keep local scans whose id the server set
  // does not (yet) contain, and let server rows win for everything else.
  const serverScans = (scansResult.data || []).map((scan) => ({
    ...scan,
    offline: false,
    _offline: false,
  }));
  const serverScanIds = new Set(serverScans.map((scan) => String(scan.id)));
  const pendingLocalScans = getNfcScans().filter(
    (scan) => !serverScanIds.has(String(scan.id)),
  );
  await writeCache(
    'nightguard_nfc_scans',
    [...pendingLocalScans, ...serverScans].sort(
      (a, b) => new Date(b.scanned_at || 0) - new Date(a.scanned_at || 0),
    ),
  );
  mapGuardRows();

  await Promise.allSettled([
    loadSiteLookupData(siteSettings),
    loadPatrolConfiguration(siteSettings),
    loadDeviceConfiguration(siteSettings),
    loadReportSchedules(siteSettings),
  ]);

  const completedAt = new Date().toISOString();
  saveLastSyncAt(completedAt);
  await recordDeviceSyncLog({
    syncType: 'cache_refresh',
    syncStatus: 'completed',
    recordsSynced: [
      pedestriansResult.data?.length || 0,
      vehiclesResult.data?.length || 0,
      incidentsResult.data?.length || 0,
      obEntriesResult.data?.length || 0,
      scansResult.data?.length || 0,
    ].reduce((acc, value) => acc + value, 0),
    completedAt,
  }, siteSettings).catch(() => null);

  window.dispatchEvent(new Event('nightguard_lookup_updated'));
  window.dispatchEvent(new Event('nightguard_patrol_config_updated'));
  return { refreshed: true };
}

export async function recordDeviceSyncLog({
  syncType = 'full_sync',
  syncStatus = 'completed',
  recordsSynced = 0,
  errorMessage = '',
  startedAt,
  completedAt = new Date().toISOString(),
}, siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  if (!navigator.onLine || !siteId) return null;

  const deviceRecord = getCurrentDeviceRecord(siteSettings);
  if (!deviceRecord?.id) return null;

  const payload = {
    device_id: deviceRecord.id,
    sync_type: syncType,
    sync_status: syncStatus,
    records_synced: recordsSynced,
    error_message: errorMessage || null,
    started_at: startedAt || completedAt,
    completed_at: completedAt,
  };

  const { data, error } = await supabase
    .from('device_sync_logs')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error && !shouldFallbackToLocal(error)) {
    throw new Error(error.message);
  }

  await supabase
    .from('devices')
    .update({
      latest_sync_update: completedAt,
      updated_at: completedAt,
    })
    .eq('id', deviceRecord.id);

  return data || null;
}
