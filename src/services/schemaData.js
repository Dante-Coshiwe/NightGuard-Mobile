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
  markPendingSchemaSync,
  saveLastSyncAt,
  saveCachedGuards,
  saveCachedPedestrians,
  saveCachedSiteSettings,
  saveCachedVehicles,
  saveDeviceSettings,
  saveLookupData,
  savePatrolConfig,
  saveQuickSwitchEnabled,
} from '../lib/deviceStore';
import { setCachedIncidents, setCachedObEntries } from '../lib/reportCache';
import { isValidCoordinate } from '../lib/geo';

function getSupabaseErrorMessage(error) {
  return String(error?.message || error?.details || error?.hint || '').trim();
}

// ── Two failures that were treated as one, and cost a site its patrol points ──
//
// A device that cannot REACH the server and a server that REFUSES the write are
// not the same event, and they were both answered with "saved locally, will sync
// later". For a flat tunnel that is true and kind. For a refusal it is a lie: the
// write will be refused again on every retry, for ever, and the operator walks
// away believing the work is safe.
//
// On 2026-09-07 that cost a Fountainbrook supervisor nine patrol points. The
// schedule row is written before the checkpoints in savePatrolConfiguration, so
// the site was left with a correct schedule and NO checkpoints, and the screen
// said "saved". Keep these two apart.

// Cannot reach the server. The cache is genuinely the right answer, and the write
// is genuinely worth retrying — includes the 12s client deadline in lib/supabase.js.
function isOfflineError(error) {
  const message = getSupabaseErrorMessage(error).toLowerCase();
  return (
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

// Reached the server and was turned away: RLS, a missing grant, or a column this
// build thinks exists and the database does not. Retrying changes nothing, so
// this must reach the operator as a failure rather than a queued save.
function isBlockedError(error) {
  const message = getSupabaseErrorMessage(error).toLowerCase();
  return (
    message.includes('row-level security') ||
    message.includes('violates row-level security') ||
    message.includes('schema cache') ||
    message.includes('could not find the') ||
    message.includes('permission denied') ||
    message.includes('not found in the schema cache')
  );
}

// Reads only. A read that fails for either reason should fall back to the cached
// copy rather than blowing up a screen — but the CALLER must still know it failed,
// so it never mistakes "I could not read your points" for "you have no points".
function shouldFallbackToLocal(error) {
  return isOfflineError(error) || isBlockedError(error);
}

function markPendingAndReturn(key, value) {
  markPendingSchemaSync(key, true);
  return { ...value, _offline: true };
}

// Every patrol write goes through this, so no branch can quietly reintroduce the
// "saved locally" lie. Offline queues and retries; refused throws with the reason
// the operator needs, and the pending flag is NOT set -- a write that will never
// be accepted must not sit in the queue pretending it will be.
function patrolWriteFailure(error, what, normalisedConfig) {
  if (isOfflineError(error)) return markPendingAndReturn('patrolConfig', normalisedConfig);
  clearPendingSchemaSync('patrolConfig');
  const detail = getSupabaseErrorMessage(error) || 'unknown error';
  throw new Error(
    isBlockedError(error)
      ? `${what} was refused by the server and has NOT been saved: ${detail}. Nothing will retry this — the patrol points are still only on this device.`
      : `${what} failed and has NOT been saved: ${detail}`,
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// The binding first, deliberately. Cached site settings are refreshed FROM the binding
// (getMySite -> getCurrentSiteId -> getSiteBinding), so the two normally agree — but the cache
// lags it, and the window where they disagree is exactly the one that matters on a multi-site
// estate: a device relocated on the dashboard has the new binding immediately and the old cached
// settings until an online refresh lands. Config written against the stale answer lands on the
// wrong site. Every write path in the app now resolves site the same way.
function getSiteId(siteSettings = getCachedSiteSettings()) {
  return getBoundSiteIdSync() || siteSettings?.id || null;
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
  // NEVER substitutes DEFAULT_PATROL_CONFIG.checkpoints for an empty list. It used
  // to, and that is what showed an operator the three seeded defaults after their
  // own points failed to save — and then wrote those defaults back to the server.
  // An empty list means "this site has no points"; deciding whether that is true
  // or merely unreadable is the caller's job, and it needs the read error to do it.
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
    : [];

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
  // — matching saveDeviceConfiguration below.
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

  // A read that FAILED is not a site with no patrol points.
  //
  // Everything below decides what this site's layout is, and it used to reach that
  // decision from `checkpoints` alone — which is null or [] whether the site is
  // genuinely empty or the read was refused or timed out. So a failed read looked
  // exactly like a fresh site, the seeded defaults were adopted, and then written
  // to the server over the real layout. Bail out here instead: the cached config is
  // the best copy anybody has, and it must not be touched or overwritten.
  if (checkpointsError || scheduleError) {
    console.warn("[PatrolConfig] could not read this site's patrol setup; keeping the copy on this device untouched:",
      getSupabaseErrorMessage(checkpointsError || scheduleError));
    return cachedPatrolConfig;
  }

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

  const hasRemoteCheckpoints = Array.isArray(checkpoints) && checkpoints.length > 0;
  const localCheckpoints = Array.isArray(localBaseline.checkpoints) ? localBaseline.checkpoints : [];
  // Points this device is holding that the server has never acknowledged. After a
  // refused or dropped save this is the ONLY copy of the operator's work.
  const hasUnsyncedLocalPoints = !hasRemoteCheckpoints
    && localCheckpoints.some((c) => String(c?.name || '').trim());

  let localConfig;
  if (hasRemoteCheckpoints) {
    // The server has the layout: it wins, and nothing needs pushing back.
    localConfig = mapPatrolConfig(scheduleRow, checkpoints);
    savePatrolConfig({ ...localConfig, site_id: siteId });
  } else if (hasUnsyncedLocalPoints) {
    // The server has none and this device has some. Keep the local points and try
    // to push them up — do NOT let an empty server list wipe unsynced work. This is
    // the case that lost a site its patrol points: the layout was replaced by the
    // seeded defaults and those were then written to the server.
    localConfig = {
      ...mapPatrolConfig(scheduleRow, checkpoints),
      checkpoints: localCheckpoints,
    };
    savePatrolConfig({ ...localConfig, site_id: siteId });
    try {
      await savePatrolConfiguration(localConfig, siteSettings);
      console.info(`[PatrolConfig] pushed ${localCheckpoints.length} unsynced patrol point(s) up for site ${siteId}`);
    } catch (err) {
      // Left on the device and retried on the next load. Logged loudly rather than
      // swallowed, because this is the moment somebody's setup is at risk.
      console.error('[PatrolConfig] unsynced patrol points still could not be saved:', err?.message || err);
    }
  } else {
    // Genuinely nothing anywhere: a new site. Seeding the defaults here is the one
    // place it is correct, because there is no real layout to destroy.
    localConfig = localBaseline;
    savePatrolConfig({ ...localConfig, site_id: siteId });
    if (!scheduleRow) {
      try {
        await savePatrolConfiguration(localConfig, siteSettings);
      } catch (err) {
        console.warn('[PatrolConfig] could not seed a new site:', err?.message || err);
        return localConfig;
      }
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
    return patrolWriteFailure(scheduleSelectError, 'Reading the patrol schedule', normalisedConfig);
  }

  const scheduleExists = Array.isArray(existingSchedules) && existingSchedules.length > 0;
  const { error: scheduleError } = scheduleExists
    ? await supabase.from('site_patrol_schedules').update(schedulePayload).eq('site_id', siteId)
    : await supabase.from('site_patrol_schedules').insert(schedulePayload);

  if (scheduleError) {
    return patrolWriteFailure(scheduleError, 'Saving the patrol schedule', normalisedConfig);
  }

  const currentCheckpoints = Array.isArray(normalisedConfig.checkpoints) ? normalisedConfig.checkpoints : [];
  const syncedIds = currentCheckpoints.filter((item) => isUuid(item.id)).map((item) => item.id);

  const { data: existingRows, error: existingError } = await supabase
    .from('patrol_checkpoints')
    .select('id')
    .eq('site_id', siteId);

  if (existingError) {
    return patrolWriteFailure(existingError, "Reading this site's existing patrol points", normalisedConfig);
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
      // A still-referenced checkpoint (FK 23503 — e.g. the scan unlink was denied by RLS)
      // must not abort the whole save; leave the orphaned row behind and keep going.
      if (deleteError.code === '23503') {
        console.warn('[PatrolConfig] Could not delete referenced checkpoints; leaving them in place:', deleteError.message);
      } else {
        return patrolWriteFailure(deleteError, 'Removing deleted patrol points', normalisedConfig);
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
        return patrolWriteFailure(checkpointError, 'Updating the existing patrol points', normalisedConfig);
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
        return patrolWriteFailure(insertError, `Saving ${newCheckpointRows.length} new patrol point${newCheckpointRows.length === 1 ? '' : 's'}`, normalisedConfig);
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

  // A device upgrading from a build that still had the report-email screen can carry a
  // `reportSchedules` pending marker for a table nothing writes any more. Clear it so
  // the sync does not stay permanently "pending" against work that no longer exists.
  if (pending.reportSchedules) {
    clearPendingSchemaSync('reportSchedules');
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

/**
 * Make sure this phone has a row in `devices`, creating it the first time.
 *
 * Nothing in the app ever inserted one: `getCurrentDeviceRecord` only ever matched against rows
 * an admin was expected to type into the dashboard by hand, and nobody ever did. So the table sat
 * empty, every `latest_sync_update` write below was dead code against a record that did not exist,
 * and the dashboard's device roster and "devices online" count were permanently zero.
 *
 * Keyed on the hardware-bound id (`NG-<ANDROID_ID>`, survives reinstall), so a handset registers
 * once and keeps that row for its life. Select-then-insert rather than upsert on purpose: there is
 * no DDL access here (see CLAUDE.md), so a unique index on device_id cannot be assumed.
 *
 * Best effort by design — a device that cannot register must still be able to work a shift, so
 * every failure path returns null quietly rather than throwing into the caller's sync.
 */
// How often the handset refreshes what it reports about itself. It registers on launch and on
// every resume, and a write on each of those would be pointlessly chatty.
const DEVICE_TELEMETRY_REFRESH_MS = 5 * 60 * 1000;
const DEVICE_TELEMETRY_KEY = 'nightguard_device_telemetry_at';
// app_started_at means what it says: stamped once per JS session, not on every refresh.
let telemetryStartStamped = false;

/**
 * Everything the handset can say about itself without a native change.
 *
 * All of this comes from @capacitor/device, which is already registered in every shipped APK —
 * it is what mints the hardware-bound device id — so this ships over the air and needs no
 * reinstall. Anything requiring a plugin that is NOT already in the APK could not.
 *
 * Battery is a SNAPSHOT taken at this moment, not a live reading: the dashboard's "last seen"
 * column is what tells a manager how old it is. A phone that has not opened the app in a day is
 * reporting yesterday's battery, and no amount of polling here changes that.
 */
async function collectDeviceTelemetry() {
  const telemetry = {};

  try {
    const { Device } = await import('@capacitor/device');
    const info = await Device.getInfo();
    telemetry.model = [info?.manufacturer, info?.model].filter(Boolean).join(' ') || null;
    telemetry.os_version = info?.osVersion ? `Android ${info.osVersion}` : null;

    const free = Number(info?.realDiskFree);
    const total = Number(info?.realDiskTotal);
    if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
      telemetry.storage_available_percent = Math.round((free / total) * 100);
    }

    const battery = await Device.getBatteryInfo();
    const level = Number(battery?.batteryLevel);
    // Reported 0..1 by the plugin; the column holds a whole percentage.
    if (Number.isFinite(level)) telemetry.battery_level = Math.round(level * 100);
  } catch (err) {
    console.warn('[NightGuard] device telemetry unavailable:', err?.message || err);
  }

  // The version a manager actually needs: which web bundle is running, and which APK shell it is
  // running inside. They are numbered on separate schemes and both matter, so report both in the
  // one column the dashboard shows.
  try {
    const { getRunningVersion } = await import('./liveUpdate');
    const bundleVersion = await getRunningVersion();
    let nativeVersion = null;
    try {
      const { App } = await import('@capacitor/app');
      nativeVersion = (await App.getInfo())?.version || null;
    } catch { /* web build, or no App plugin */ }
    telemetry.app_version = nativeVersion ? `${bundleVersion} (APK ${nativeVersion})` : bundleVersion;
  } catch (err) {
    console.warn('[NightGuard] version telemetry unavailable:', err?.message || err);
  }

  if (!telemetryStartStamped) {
    telemetry.app_started_at = new Date().toISOString();
  }

  return telemetry;
}

function telemetryIsDue() {
  try {
    const last = Number(localStorage.getItem(DEVICE_TELEMETRY_KEY));
    return !Number.isFinite(last) || Date.now() - last > DEVICE_TELEMETRY_REFRESH_MS;
  } catch {
    return true;
  }
}

function markTelemetryWritten() {
  try {
    localStorage.setItem(DEVICE_TELEMETRY_KEY, String(Date.now()));
  } catch { /* storage full or blocked; the throttle is an optimisation, not a guarantee */ }
  telemetryStartStamped = true;
}

/** Refresh what a already-registered handset reports about itself, throttled. */
async function refreshDeviceTelemetry(deviceRowId) {
  if (!deviceRowId || !telemetryIsDue()) return;
  try {
    const telemetry = await collectDeviceTelemetry();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('devices')
      .update({ ...telemetry, latest_sync_update: now, updated_at: now })
      .eq('id', deviceRowId);
    if (error) {
      console.warn('[NightGuard] device telemetry update refused:', getSupabaseErrorMessage(error));
      return;
    }
    markTelemetryWritten();
  } catch (err) {
    console.warn('[NightGuard] device telemetry update failed:', err?.message || err);
  }
}

export async function ensureDeviceRecord(siteSettings = getCachedSiteSettings()) {
  const siteId = getSiteId(siteSettings);
  const hardwareId = getDeviceId();
  if (!siteId || !hardwareId || !navigator.onLine) return null;

  const known = getCurrentDeviceRecord(siteSettings);
  if (known?.id) {
    // Already registered — keep model, battery and version current rather than frozen at the
    // moment of first registration.
    await refreshDeviceTelemetry(known.id);
    return known;
  }

  const rememberDevice = (record) => {
    if (!record?.id) return null;
    const devices = Array.isArray(siteSettings?.devices) ? siteSettings.devices : [];
    saveCachedSiteSettings({
      ...siteSettings,
      devices: [...devices.filter((device) => String(device.id) !== String(record.id)), record],
    });
    return record;
  };

  try {
    // Someone may have registered it already — an admin by hand, or this handset before a
    // reinstall wiped the local cache. Adopt that row instead of creating a duplicate.
    //
    // ⚠ Look up on the HARDWARE ID ALONE. `devices.device_id` is globally UNIQUE, so there is at
    // most one row and scoping the lookup by site cannot find more — it can only fail to find the
    // one that exists. This used to filter `.eq('site_id', siteId)` as well, and that single
    // clause is what wedged a handset permanently:
    //
    //   lookup misses (the row's site_id is null, or still the previous site)
    //     -> falls through to INSERT
    //     -> INSERT violates the unique index on device_id
    //     -> ensureDeviceRecord returns null, FOREVER
    //     -> device_id is null on every ob entry, incident, patrol and shift the device writes,
    //        recordDeviceSyncLog bails before logging, and the dashboard shows the handset as
    //        unregistered and permanently offline.
    //
    // Every route into that state is ordinary admin work: unbinding a device, deleting or moving
    // its location, or binding a brand-new site (the row is created against the first site, then
    // the site changes underneath it). Observed on NG-8A15B196B6DE42CF, whose row was soft-deleted
    // on 2026-08-17 — it kept checking in for over an hour afterwards writing nothing attributable.
    const { data: existing, error: findError } = await supabase
      .from('devices')
      .select('*')
      .eq('device_id', hardwareId)
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.warn('[NightGuard] device lookup failed:', getSupabaseErrorMessage(findError));
      return null;
    }
    if (existing?.id) {
      // Adopted a row someone else created (an admin by hand, or this handset before a reinstall
      // wiped the local cache). It may hold nothing but a name, so fill in what we know.
      //
      // Re-home it if it is pointing somewhere else, and un-delete it if an admin removed it: the
      // handset is demonstrably here and working this site, and a soft-deleted row otherwise keeps
      // it invisible on the dashboard for the rest of its life. Best-effort — a refusal here must
      // not stop the device working, so the row is still adopted either way.
      const needsRehome = String(existing.site_id || '') !== String(siteId)
        || existing.deleted_at
        || existing.is_active === false;

      if (needsRehome) {
        const rehomedAt = new Date().toISOString();
        const { data: rehomed, error: rehomeError } = await supabase
          .from('devices')
          .update({
            site_id: siteId,
            deleted_at: null,
            is_active: true,
            site_bound_at: existing.site_bound_at || rehomedAt,
            updated_at: rehomedAt,
          })
          .eq('id', existing.id)
          .select('*')
          .maybeSingle();

        if (rehomeError) {
          console.warn('[NightGuard] device re-home refused:', getSupabaseErrorMessage(rehomeError));
        } else if (rehomed?.id) {
          await refreshDeviceTelemetry(rehomed.id);
          return rememberDevice(rehomed);
        }
      }

      await refreshDeviceTelemetry(existing.id);
      return rememberDevice(existing);
    }

    const now = new Date().toISOString();
    const telemetry = await collectDeviceTelemetry();
    const { data: created, error: createError } = await supabase
      .from('devices')
      .insert({
        site_id: siteId,
        device_id: hardwareId,
        // Prefer something a manager can recognise on sight over the raw hardware id.
        device_name: getDeviceSettings()?.deviceDescription || telemetry.model || hardwareId,
        is_active: true,
        latest_sync_update: now,
        site_bound_at: now,
        ...telemetry,
      })
      .select('*')
      .maybeSingle();

    if (createError) {
      // A row for this hardware id already exists (unique index on devices.device_id) but the
      // SELECT above could not see it — an RLS policy that scopes reads by site will do exactly
      // that for a device whose row points at another site. Claim it by hardware id rather than
      // giving up, or the handset stays unregistered forever and writes nothing attributable.
      if (createError.code === '23505') {
        const rescuedAt = new Date().toISOString();
        const { data: rescued } = await supabase
          .from('devices')
          .update({ site_id: siteId, deleted_at: null, is_active: true, updated_at: rescuedAt })
          .eq('device_id', hardwareId)
          .select('*')
          .maybeSingle();
        if (rescued?.id) {
          console.info(`[NightGuard] adopted the existing device row for ${hardwareId}`);
          await refreshDeviceTelemetry(rescued.id);
          return rememberDevice(rescued);
        }
      }

      // RLS may not grant guards insert on devices. Nothing is lost by failing here — this is
      // exactly today's behaviour — so log it and let the shift carry on.
      console.warn('[NightGuard] device self-registration refused:', getSupabaseErrorMessage(createError));
      return null;
    }

    markTelemetryWritten();
    console.info(`[NightGuard] registered this device as ${hardwareId} (${telemetry.model || 'unknown model'})`);
    return rememberDevice(created);
  } catch (err) {
    console.warn('[NightGuard] device self-registration failed:', err?.message || err);
    return null;
  }
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

  // Register on the way past. This runs after every successful offline-queue drain, so a phone
  // that has never been seen before appears in the dashboard the first time it syncs rather than
  // waiting for an admin to add it by hand.
  const deviceRecord = await ensureDeviceRecord(siteSettings);
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
