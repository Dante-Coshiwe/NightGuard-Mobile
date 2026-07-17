import { supabase } from '../lib/supabase';
import {
  GENERAL_GUARD,
  getCachedGuards,
  getCachedPatrols,
  getCachedSiteSettings,
  getNfcScans,
  getPatrolConfig,
  getShiftSession,
  saveCachedGuards,
  upsertCachedGuard,
  updateCachedGuard,
  upsertCachedPatrol,
  isGeneralGuardId,
} from '../lib/deviceStore';

const SITE_ID = import.meta.env.VITE_SITE_ID || null;
const CACHED_USER_KEY = 'nightguard_cached_user';

class ApiError extends Error {
  constructor(message, status = 400, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = {
      status,
      data: data || { error: message },
    };
  }
}

function throwApiError(message, status = 400, data = null) {
  throw new ApiError(message, status, data);
}

function throwSupabaseError(error, status = 400) {
  throwApiError(error?.message || 'Database request failed', status, {
    error: error?.message || 'Database request failed',
    details: error,
  });
}

function normaliseProfile(profile = {}) {
  return {
    ...profile,
    name: profile.name || profile.full_name || 'Unnamed User',
    full_name: profile.full_name || profile.name || 'Unnamed User',
    role: profile.role || profile.user_type || 'guard',
    user_type: profile.user_type || profile.role || 'guard',
    pin: String(profile.pin || profile.guard_pin || '1234'),
    guard_pin: String(profile.guard_pin || profile.pin || '1234'),
    is_active: profile.is_active !== false,
  };
}

function normaliseLocalGuard(guard = {}) {
  return {
    ...guard,
    name: guard.name || guard.full_name || 'Unnamed Guard',
    full_name: guard.full_name || guard.name || 'Unnamed Guard',
    role: 'guard',
    user_type: 'guard',
    pin: String(guard.pin || guard.guard_pin || '1234'),
    guard_pin: String(guard.guard_pin || guard.pin || '1234'),
    is_active: guard.is_active !== false,
    _localOnly: guard._localOnly !== false,
  };
}

function getCachedUser() {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function nullableUuid(value) {
  return isUuid(value) ? value : null;
}

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throwSupabaseError(error, 401);
  return data.session || null;
}

async function requireSession() {
  const session = await getSession();
  if (!session) {
    throwApiError('An authenticated Supabase session is required', 401);
  }
  return session;
}

async function getProfileById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throwSupabaseError(error, 400);
  return data ? normaliseProfile(data) : null;
}

async function getLocalGuardById(id) {
  if (!id || !isGeneralGuardId(id)) return null;
  return normaliseLocalGuard(GENERAL_GUARD);
}

async function getCurrentProfile() {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const profile = await getProfileById(session.user.id);
  if (!profile) {
    return {
      id: session.user.id,
      email: session.user.email || '',
      full_name: session.user.user_metadata?.full_name || session.user.email || 'Authenticated User',
      name: session.user.user_metadata?.full_name || session.user.email || 'Authenticated User',
      user_type: 'guard',
      role: 'guard',
      is_active: true,
      site_id: SITE_ID,
    };
  }
  return {
    ...profile,
    email: profile.email || session.user.email || '',
  };
}

async function getActorId() {
  const cachedUser = getCachedUser();
  if (cachedUser?.id) return cachedUser.id;
  const session = await getSession();
  return session?.user?.id || null;
}

async function getCurrentSiteId() {
  const cachedUser = getCachedUser();
  if (cachedUser?.site_id) return cachedUser.site_id;
  const profile = await getCurrentProfile();
  return profile?.site_id || SITE_ID || null;
}

async function getCurrentOrganizationId() {
  const cachedSite = getCachedSiteSettings();
  if (cachedSite?.organization_id) return cachedSite.organization_id;
  const siteId = await getCurrentSiteId();
  if (!siteId) return null;
  const { data, error } = await supabase
    .from('sites')
    .select('organization_id')
    .eq('id', siteId)
    .maybeSingle();

  if (error) throwSupabaseError(error, 400);
  return data?.organization_id || null;
}

function getLocalGuardId(payload = {}) {
  return nullableUuid(payload.local_guard_id || payload.localGuardId || payload.guard_id || payload.guardId);
}

function resolveGuardRefs(payload = {}, fallbackGuardId = null) {
  const candidate = payload.local_guard_id || payload.localGuardId || payload.guard_id || payload.guardId || fallbackGuardId;

  if (!candidate || isGeneralGuardId(candidate)) {
    return { guard_id: null, local_guard_id: null };
  }

  const cachedGuard = getCachedGuards().find((guard) => String(guard.id) === String(candidate));
  if (cachedGuard && !isGeneralGuardId(cachedGuard.id)) {
    return {
      guard_id: null,
      local_guard_id: nullableUuid(cachedGuard.id),
    };
  }

  if (payload.local_guard_id || payload.localGuardId) {
    return {
      guard_id: null,
      local_guard_id: nullableUuid(candidate),
    };
  }

  return {
    guard_id: nullableUuid(candidate),
    local_guard_id: null,
  };
}

function resolveProfileActorId(candidate) {
  if (!candidate || isGeneralGuardId(candidate)) {
    return null;
  }

  const cachedGuard = getCachedGuards().find((guard) => String(guard.id) === String(candidate));
  if (cachedGuard) {
    return null;
  }

  return nullableUuid(candidate);
}

async function getSiteWithRelations(siteId) {
  if (!siteId) return null;

  const [{ data: site, error: siteError }, { data: devices, error: devicesError }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', siteId).maybeSingle(),
    supabase.from('devices').select('*').eq('site_id', siteId).order('created_at', { ascending: true }),
  ]);

  if (siteError) throwSupabaseError(siteError, 400);
  if (devicesError) throwSupabaseError(devicesError, 400);
  if (!site) return null;

  let organization = null;
  if (site.organization_id) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', site.organization_id)
      .maybeSingle();
    if (error) throwSupabaseError(error, 400);
    organization = data;
  }

  return {
    ...site,
    location_name: site.site_name,
    site_name: site.site_name,
    organizations: organization || { org_name: '' },
    devices: devices || [],
  };
}

async function mapRowsWithProfiles(rows, profileField = 'guard_id', outputField = 'guard_name') {
  const authIds = [...new Set((rows || []).map((row) => row?.[profileField]).filter(Boolean))];

  const profilesResult = authIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', authIds)
    : { data: [], error: null };

  if (profilesResult.error) throwSupabaseError(profilesResult.error, 400);

  const profileMap = new Map((profilesResult.data || []).map((profile) => [String(profile.id), profile.full_name]));

  return (rows || []).map((row) => ({
    ...row,
    [outputField]: row[outputField]
      || profileMap.get(String(row[profileField]))
      || GENERAL_GUARD.full_name,
  }));
}

async function getPatrolCheckpointCounts(patrolIds) {
  if (!patrolIds.length) return new Map();

  const { data, error } = await supabase
    .from('patrol_checkpoints')
    .select('patrol_id, status')
    .in('patrol_id', patrolIds);

  if (error) throwSupabaseError(error, 400);

  return (data || []).reduce((map, checkpoint) => {
    const key = String(checkpoint.patrol_id);
    const current = map.get(key) || { total: 0, completed: 0 };
    current.total += 1;
    if (checkpoint.status === 'scanned' || checkpoint.status === 'completed') {
      current.completed += 1;
    }
    map.set(key, current);
    return map;
  }, new Map());
}

async function listPatrols(filter = {}) {
  const siteId = filter.siteId || await getCurrentSiteId();
  const cachedPatrols = getCachedPatrols();

  if (!navigator.onLine) {
    return cachedPatrols.filter((patrol) => (
      (!siteId || String(patrol.site_id) === String(siteId)) &&
      (!filter.id || String(patrol.id) === String(filter.id)) &&
      (!filter.guardId || String(patrol.local_guard_id) === String(filter.guardId) || String(patrol.guard_id) === String(filter.guardId))
    ));
  }

  let query = supabase.from('patrols').select('*').order('created_at', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);
  if (filter.guardId) {
    const guardRefs = resolveGuardRefs({ guard_id: filter.guardId });
    if (guardRefs.local_guard_id) {
      query = query.eq('local_guard_id', guardRefs.local_guard_id);
    } else if (guardRefs.guard_id) {
      query = query.eq('guard_id', guardRefs.guard_id);
    }
  }
  if (filter.id) query = query.eq('id', filter.id);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);

  const rows = await mapRowsWithProfiles(data || []);
  const checkpointCounts = await getPatrolCheckpointCounts(rows.map((row) => row.id).filter(Boolean));

  const mapped = rows.map((row) => {
    const counts = checkpointCounts.get(String(row.id)) || { total: 0, completed: 0 };
    return {
      ...row,
      total_checkpoints: counts.total,
      checkpoints_completed: counts.completed,
    };
  });
  mapped.forEach(upsertCachedPatrol);
  return mapped.length ? mapped : cachedPatrols;
}

async function listGuardProfiles(siteId) {
  return saveCachedGuards([
    normaliseLocalGuard({
      ...GENERAL_GUARD,
      site_id: siteId || await getCurrentSiteId(),
      _localOnly: true,
    }),
  ]);
}

async function createGuardProfile(payload) {
  const guard = normaliseLocalGuard({
    ...GENERAL_GUARD,
    site_id: payload.site_id || await getCurrentSiteId(),
    _offline: false,
    _localOnly: true,
  });
  upsertCachedGuard(guard);
  return guard;
}

async function getCurrentShift(siteId) {
  const cachedShift = getShiftSession();
  if (!navigator.onLine && cachedShift) {
    return {
      id: cachedShift.id,
      site_id: cachedShift.siteId || siteId || null,
      local_guard_id: cachedShift.activeGuardId || null,
      guard_name: cachedShift.activeGuardName || 'Active Guard',
      shift_name: cachedShift.shiftLabel,
      status: cachedShift.status || 'active',
      started_at: cachedShift.startedAt,
      start_time: cachedShift.startedAt,
      _offline: true,
    };
  }

  let query = supabase
    .from('shifts')
    .select('*')
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1);

  if (siteId) query = query.eq('site_id', siteId);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);

  const shift = data?.[0] || null;
  if (!shift) return null;

  const [guard, localGuard] = await Promise.all([
    getProfileById(shift.guard_id),
    getLocalGuardById(shift.local_guard_id),
  ]);
  return {
    ...shift,
    guard_name: localGuard?.full_name || guard?.full_name || shift.guard_name || GENERAL_GUARD.full_name,
    start_time: shift.started_at,
  };
}

async function startShiftRecord(payload) {
  const siteId = payload.site_id || await getCurrentSiteId();
  const shiftName = payload.shift_name || payload.shiftLabel || 'Day Shift';
  const guardId = payload.guard_id || payload.guardId || null;
  const guardRefs = resolveGuardRefs(payload, guardId);

  const insertPayload = {
    ...(isUuid(payload.id) ? { id: payload.id } : {}),
    site_id: siteId,
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    shift_name: shiftName,
    started_at: payload.started_at || new Date().toISOString(),
    status: 'active',
  };

  const { data, error } = await supabase
    .from('shifts')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  const [guard, localGuard] = await Promise.all([
    getProfileById(data.guard_id),
    getLocalGuardById(data.local_guard_id),
  ]);
  return {
    ...data,
    guard_name: localGuard?.full_name || guard?.full_name || GENERAL_GUARD.full_name,
    start_time: data.started_at,
  };
}

async function endShiftRecord(payload = {}) {
  const shiftId = payload.shift_id;
  let query = supabase
    .from('shifts')
    .update({
      ended_at: new Date().toISOString(),
      status: 'closed',
    })
    .select('*');

  if (shiftId) {
    query = query.eq('id', shiftId);
  } else {
    const siteId = await getCurrentSiteId();
    query = query.eq('site_id', siteId).eq('status', 'active');
  }

  const { data, error } = await query.limit(1);
  if (error) throwSupabaseError(error, 400);
  return data?.[0] || null;
}

async function listCompletedShifts() {
  const siteId = await getCurrentSiteId();
  let query = supabase
    .from('shifts')
    .select('*')
    .neq('status', 'active')
    .order('started_at', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);

  const rows = await mapRowsWithProfiles(data || []);
  return rows.map((row) => ({
    ...row,
    start_time: row.started_at,
    end_time: row.ended_at,
  }));
}

async function listPedestrians({ currentGuardOnly = false } = {}) {
  const siteId = await getCurrentSiteId();
  let query = supabase
    .from('pedestrians')
    .select('*')
    .order('entry_time', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);
  if (currentGuardOnly) {
    const actorId = await getActorId();
    const guardRefs = resolveGuardRefs({ guard_id: actorId });
    if (guardRefs.local_guard_id) {
      query = query.eq('local_guard_id', guardRefs.local_guard_id);
    } else if (guardRefs.guard_id) {
      query = query.eq('guard_id', guardRefs.guard_id);
    }
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);
  return data || [];
}

async function createPedestrian(payload) {
  if (!String(payload.full_name || '').trim() || !String(payload.visiting_unit || '').trim()) {
    throwApiError('Full name and visiting unit are required', 400);
  }

  const guardRefs = resolveGuardRefs(payload);
  const { _pendingPhoto, ...columns } = payload;
  const insertPayload = {
    ...columns,
    site_id: payload.site_id || await getCurrentSiteId(),
    shift_id: nullableUuid(payload.shift_id),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    entry_time: payload.entry_time || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('pedestrians')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function markPedestrianExited(id) {
  const exitTime = new Date().toISOString();
  const { data, error } = await supabase
    .from('pedestrians')
    .update({ exit_time: exitTime, exited_at: exitTime })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function listVehicles({ currentGuardOnly = false } = {}) {
  const siteId = await getCurrentSiteId();
  let query = supabase
    .from('vehicles')
    .select('*')
    .order('entered_at', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);
  if (currentGuardOnly) {
    const actorId = await getActorId();
    const guardRefs = resolveGuardRefs({ guard_id: actorId });
    if (guardRefs.local_guard_id) {
      query = query.eq('local_guard_id', guardRefs.local_guard_id);
    } else if (guardRefs.guard_id) {
      query = query.eq('guard_id', guardRefs.guard_id);
    }
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);
  return data || [];
}

async function createVehicle(payload) {
  // License plate is no longer captured at the gate (see relax-constraints migration); only the
  // driver name and visiting unit are required now.
  if (
    !String(payload.driver_name || '').trim() ||
    !String(payload.visiting_unit || '').trim()
  ) {
    throwApiError('Driver name and visiting unit are required', 400);
  }

  const guardRefs = resolveGuardRefs(payload);
  const { _pendingPhoto, ...columns } = payload;
  const insertPayload = {
    ...columns,
    site_id: payload.site_id || await getCurrentSiteId(),
    shift_id: nullableUuid(payload.shift_id),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    entered_at: payload.entered_at || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('vehicles')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function markVehicleExited(id) {
  const exitTime = new Date().toISOString();
  const { data, error } = await supabase
    .from('vehicles')
    .update({ exited_at: exitTime })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function listIncidents() {
  const siteId = await getCurrentSiteId();
  let query = supabase
    .from('incidents')
    .select('*')
    .order('reported_at', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);
  return data || [];
}

async function createIncident(payload) {
  const guardRefs = resolveGuardRefs(payload);
  const insertPayload = {
    ...payload,
    site_id: payload.site_id || await getCurrentSiteId(),
    shift_id: nullableUuid(payload.shift_id),
    reported_by: resolveProfileActorId(payload.reported_by),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    reported_at: payload.reported_at || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('incidents')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function createSecurityEvent(payload) {
  const insertPayload = {
    device_id: payload.device_id || null,
    guard_id: nullableUuid(payload.guard_id),
    shift_id: nullableUuid(payload.shift_id),
    type: payload.type || 'system',
    severity: payload.severity || 'info',
    occurred_at: payload.occurred_at || new Date().toISOString(),
    metadata: payload.metadata || {},
  };

  const { data, error } = await supabase
    .from('security_events')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function listObEntries() {
  const siteId = await getCurrentSiteId();
  let query = supabase
    .from('ob_entries')
    .select('*')
    .order('captured_timestamp', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);
  return data || [];
}

async function createObEntry(payload) {
  const guardRefs = resolveGuardRefs(payload);
  const insertPayload = {
    ...payload,
    site_id: payload.site_id || await getCurrentSiteId(),
    shift_id: nullableUuid(payload.shift_id),
    captured_by: resolveProfileActorId(payload.captured_by),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    captured_timestamp: payload.captured_timestamp || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('ob_entries')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function listNfcCheckpoints() {
  const siteId = await getCurrentSiteId();
  const localCheckpoints = getPatrolConfig().checkpoints.map((checkpoint, index) => ({
    ...checkpoint,
    site_id: checkpoint.site_id || siteId,
    checkpoint_order: checkpoint.checkpoint_order || index + 1,
    checkpoint_name: checkpoint.name,
  }));

  if (!navigator.onLine) {
    return localCheckpoints;
  }

  let query = supabase
    .from('patrol_checkpoints')
    .select('*')
    .order('checkpoint_order', { ascending: true });

  if (siteId) query = query.eq('site_id', siteId);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);

  const rows = (data || []).map((checkpoint) => ({
    ...checkpoint,
    checkpoint_name: checkpoint.name,
  }));
  return rows.length ? rows : localCheckpoints;
}

async function createPatrolRecord(payload = {}) {
  const siteId = payload.site_id || await getCurrentSiteId();
  const guardRefs = resolveGuardRefs(payload, payload.guard_id || payload.local_guard_id || await getActorId());
  const insertPayload = {
    ...(isUuid(payload.id) ? { id: payload.id } : {}),
    site_id: siteId,
    shift_id: nullableUuid(payload.shift_id),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    patrol_name: payload.patrol_name || payload.patrolName || 'Scheduled Patrol',
    actual_start: payload.actual_start || new Date().toISOString(),
    status: payload.status || 'in_progress',
  };

  // DO NOTHING on conflict: the row may already exist as a scan-created stub, or as the full
  // summary if /patrols/complete synced before a queued /patrols/start. Either way the existing
  // row wins — a late-syncing "start" must never regress a completed patrol to in_progress.
  const { data, error } = await supabase
    .from('patrols')
    .upsert(insertPayload, { onConflict: 'id', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();

  if (error) throwSupabaseError(error, 400);
  if (data) return data;

  const { data: existing, error: fetchError } = await supabase
    .from('patrols')
    .select('*')
    .eq('id', insertPayload.id)
    .single();

  if (fetchError) throwSupabaseError(fetchError, 400);
  return existing;
}

// Persist a finished patrol session: one patrols row (summary) plus the walked route as
// nfc_scans rows with method='route_point'. Reuses tables the device's RLS policies already
// allow (guards can insert into patrols and nfc_scans for their site); route_point rows are
// filtered out of every scan list, they exist purely so the dashboard can draw the walk on a map.
async function completePatrolRecord(payload = {}) {
  const siteId = payload.site_id || await getCurrentSiteId();
  const guardRefs = resolveGuardRefs(payload, payload.guard_id || payload.local_guard_id || await getActorId());
  const patrolId = isUuid(payload.id) ? payload.id : null;

  const patrolRow = {
    ...(patrolId ? { id: patrolId } : {}),
    site_id: siteId,
    shift_id: nullableUuid(payload.shift_id),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    patrol_name: payload.patrol_name || 'Patrol',
    actual_start: payload.actual_start || new Date().toISOString(),
    actual_end: payload.actual_end || new Date().toISOString(),
    status: payload.status || 'completed',
    steps_taken: Number.isFinite(Number(payload.steps_taken)) ? Number(payload.steps_taken) : 0,
  };

  // Upsert so an offline-queue retry never fails on the primary key.
  const { data, error } = await supabase
    .from('patrols')
    .upsert(patrolRow, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);

  const route = Array.isArray(payload.route) ? payload.route.filter((point) => (
    Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude))
  )) : [];

  if (route.length && data?.id) {
    // Skip if this patrol's route already landed (a retried queue item after a partial failure).
    const { count } = await supabase
      .from('nfc_scans')
      .select('id', { count: 'exact', head: true })
      .eq('patrol_id', data.id)
      .eq('method', 'route_point');

    if (!count) {
      const rows = route.map((point, index) => ({
        site_id: siteId,
        guard_id: guardRefs.guard_id,
        local_guard_id: guardRefs.local_guard_id,
        shift_id: nullableUuid(payload.shift_id),
        patrol_id: data.id,
        checkpoint_id: null,
        checkpoint_name: `Route point ${index + 1}`,
        tag_uid: null,
        scanned_at: point.at || new Date().toISOString(),
        status: 'route',
        method: 'route_point',
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        location_accuracy: Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy) : null,
      }));

      for (let i = 0; i < rows.length; i += 400) {
        let batch = rows.slice(i, i + 400);
        let { error: routeError } = await supabase.from('nfc_scans').insert(batch);

        // A dead shift/guard reference (FK 23503) must not throw away the whole walked route
        // (the patrols row is already saved, so a thrown 400 just gets this queue item dropped).
        // Retry once with the link columns nulled — the trail itself is what matters.
        if (routeError?.code === '23503') {
          console.warn('[api] completePatrolRecord(): dead reference in route batch, retrying unlinked:', routeError.message);
          batch = batch.map((row) => ({ ...row, shift_id: null, guard_id: null, local_guard_id: null }));
          ({ error: routeError } = await supabase.from('nfc_scans').insert(batch));
        }
        if (routeError) throwSupabaseError(routeError, 400);
      }
    }
  }

  upsertCachedPatrol({ ...data, _offline: false });
  return data;
}

// The patrol session id is minted on the device (crypto.randomUUID) when the guard taps
// "Start Patrol", but the patrols row historically only landed at /patrols/complete. Any scan
// made mid-patrol therefore referenced a patrols row that didn't exist yet and died on
// nfc_scans_patrol_id_fkey — the scan was then dropped by the queue (400 = unrecoverable).
// Insert a stub patrols row first (DO NOTHING on conflict, so a synced /patrols/start or an
// already-completed patrol is never clobbered); /patrols/complete upserts the real summary later.
async function ensurePatrolRowForScan(insertPayload) {
  if (!insertPayload.patrol_id) return;
  const { error } = await supabase
    .from('patrols')
    .upsert({
      id: insertPayload.patrol_id,
      site_id: insertPayload.site_id,
      shift_id: insertPayload.shift_id,
      guard_id: insertPayload.guard_id,
      local_guard_id: insertPayload.local_guard_id,
      patrol_name: 'Patrol',
      actual_start: insertPayload.scanned_at,
      status: 'in_progress',
    }, { onConflict: 'id', ignoreDuplicates: true });

  // If the stub can't land (RLS, bad site ref, ...), keep the scan alive without the link
  // rather than losing the guard's checkpoint proof.
  if (error) {
    console.warn('[api] ensurePatrolRowForScan(): stub patrol insert failed, unlinking scan:', error.message);
    insertPayload.patrol_id = null;
  }
}

// FK link columns a scan can carry, in substring-safe match order (local_guard_id before
// guard_id). If the insert hits a foreign-key violation (Postgres 23503 — the referenced row
// was deleted or never synced), null the offending link and retry: the scan's evidentiary
// payload (checkpoint name, tag, time, GPS fix) matters more than the dead reference.
const SCAN_FK_COLUMNS = ['patrol_id', 'checkpoint_id', 'shift_id', 'local_guard_id', 'guard_id', 'site_id'];

async function insertScanDroppingDeadRefs(insertPayload) {
  let attempt = { ...insertPayload };
  for (let i = 0; i <= SCAN_FK_COLUMNS.length; i += 1) {
    const { data, error } = await supabase
      .from('nfc_scans')
      .insert(attempt)
      .select('*')
      .single();

    if (!error) return { data, attempt };

    const errorText = `${error.message || ''} ${error.details || ''}`;
    const offending = error.code === '23503'
      ? SCAN_FK_COLUMNS.find((col) => attempt[col] && errorText.includes(col))
      : null;
    if (!offending) throwSupabaseError(error, 400);

    console.warn(`[api] insertScanDroppingDeadRefs(): dead reference in "${offending}", retrying without it`);
    attempt = { ...attempt, [offending]: null };
  }
  throwApiError('NFC scan insert failed after dropping dead references', 400);
  return null; // unreachable
}

async function createNfcScan(payload) {
  const guardRefs = resolveGuardRefs(payload, payload.guard_id || await getActorId());
  const insertPayload = {
    site_id: payload.site_id || await getCurrentSiteId(),
    guard_id: guardRefs.guard_id,
    local_guard_id: guardRefs.local_guard_id,
    shift_id: nullableUuid(payload.shift_id),
    patrol_id: nullableUuid(payload.patrol_id),
    checkpoint_id: nullableUuid(payload.checkpoint_id),
    checkpoint_name: payload.checkpoint_name || payload.point_name || 'Checkpoint',
    tag_uid: payload.tag_uid || null,
    scanned_at: payload.scanned_at || new Date().toISOString(),
    status: payload.status || 'matched',
    method: payload.method || 'nfc',
    latitude: Number.isFinite(Number(payload.latitude)) ? Number(payload.latitude) : null,
    longitude: Number.isFinite(Number(payload.longitude)) ? Number(payload.longitude) : null,
    location_accuracy: Number.isFinite(Number(payload.location_accuracy)) ? Number(payload.location_accuracy) : null,
  };

  await ensurePatrolRowForScan(insertPayload);
  const { data, attempt: savedPayload } = await insertScanDroppingDeadRefs(insertPayload);
  insertPayload.checkpoint_id = savedPayload.checkpoint_id;

  if (insertPayload.checkpoint_id) {
    await supabase
      .from('patrol_checkpoints')
      .update({
        scanned_at: insertPayload.scanned_at,
        scanned_by: insertPayload.guard_id,
        status: 'scanned',
      })
      .eq('id', insertPayload.checkpoint_id);
  }

  const guard = await getProfileById(data.guard_id);
  return {
    ...data,
    guard_name: guard?.full_name || payload.guard_name || GENERAL_GUARD.full_name,
  };
}

async function listNfcScans() {
  const siteId = await getCurrentSiteId();
  const localScans = getNfcScans();
  if (!navigator.onLine) {
    return localScans.filter((scan) => !siteId || String(scan.site_id) === String(siteId));
  }

  let query = supabase
    .from('nfc_scans')
    .select('*')
    .or('method.is.null,method.neq.route_point')
    .order('scanned_at', { ascending: false });

  if (siteId) query = query.eq('site_id', siteId);

  const { data, error } = await query;
  if (error) throwSupabaseError(error, 400);
  const rows = await mapRowsWithProfiles(data || []);

  // Merge in any local scans the server list does not yet contain (still queued,
  // or not yet synced) so an optimistic GPS/NFC check-in is never dropped from the
  // UI on refresh. Server rows win by id; local-only scans are kept and re-sorted.
  const serverIds = new Set(rows.map((scan) => String(scan.id)));
  const pendingLocal = localScans.filter((scan) => !serverIds.has(String(scan.id)));
  if (!pendingLocal.length) return rows;
  return [...pendingLocal, ...rows].sort(
    (a, b) => new Date(b.scanned_at || 0) - new Date(a.scanned_at || 0),
  );
}

async function registerNfcTag(payload) {
  const checkpointId = payload.checkpoint_id || payload.id;
  if (!checkpointId) {
    throwApiError('A checkpoint id is required to register an NFC tag', 400);
  }

  const { data, error } = await supabase
    .from('patrol_checkpoints')
    .update({ tag_uid: payload.tag_uid || null })
    .eq('id', checkpointId)
    .select('*')
    .single();

  if (error) throwSupabaseError(error, 400);
  return data;
}

async function getPatrolSummary() {
  return listPatrols();
}

async function getGuardsWithStatsData() {
  const siteId = await getCurrentSiteId();
  const [guards, patrols] = await Promise.all([
    listGuardProfiles(siteId),
    listPatrols({ siteId }),
  ]);

  return guards.map((guard) => {
    const mine = patrols.filter((patrol) => (
      String(patrol.local_guard_id) === String(guard.id) || String(patrol.guard_id) === String(guard.id)
    ));
    return {
      ...guard,
      patrol_count: mine.length,
      completed_patrols: mine.filter((patrol) => patrol.status === 'completed').length,
    };
  });
}

async function getGuardHourlyReport() {
  return getGuardsWithStatsData();
}

async function updateGuardPinRecord(id, pin) {
  const guard = normaliseLocalGuard(GENERAL_GUARD);
  updateCachedGuard(guard.id, { pin: guard.pin, guard_pin: guard.guard_pin, _offline: false });
  return guard;
}

async function toggleGuardRecord(id, isActive) {
  const guard = normaliseLocalGuard(GENERAL_GUARD);
  updateCachedGuard(guard.id, { is_active: true, _offline: false });
  return guard;
}

async function getMySiteRecord() {
  const siteId = await getCurrentSiteId();
  if (!siteId) throwApiError('No site is associated with the current device', 404);
  const site = await getSiteWithRelations(siteId);
  if (!site) throwApiError('Site not found', 404);
  return site;
}

async function updateMySiteRecord(payload) {
  const siteId = await getCurrentSiteId();
  if (!siteId) throwApiError('No site is associated with the current device', 404);

  const updatePayload = {
    ...(payload.site_name ? { site_name: payload.site_name } : {}),
    ...(payload.address !== undefined ? { address: payload.address } : {}),
    ...(payload.contact_person !== undefined ? { contact_person: payload.contact_person } : {}),
    ...(payload.contact_phone !== undefined ? { contact_phone: payload.contact_phone } : {}),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('sites')
    .update(updatePayload)
    .eq('id', siteId);

  if (error) throwSupabaseError(error, 400);
  return getMySiteRecord();
}

async function handleGet(url) {
  if (url === '/auth/me') {
    return getCurrentProfile();
  }
  if (url === '/patrols') {
    return listPatrols();
  }
  if (url === '/patrols/summary' || url === '/patrols/dashboard') {
    return getPatrolSummary();
  }
  if (url === '/patrols/points' || url === '/nfc/checkpoints') {
    return listNfcCheckpoints();
  }
  if (url.startsWith('/patrols/guard/')) {
    const guardId = url.split('/patrols/guard/')[1];
    return listPatrols({ guardId });
  }
  if (url === '/patrols/my-patrols') {
    const actorId = await getActorId();
    return listPatrols({ guardId: actorId });
  }
  if (url === '/patrols/my-checkpoints') {
    const actorId = await getActorId();
    const scans = await listNfcScans();
    return scans.filter((scan) => (
      String(scan.guard_id) === String(actorId) || String(scan.local_guard_id) === String(actorId)
    ));
  }
  if (url.startsWith('/patrols/')) {
    const patrolId = url.split('/patrols/')[1];
    const data = await listPatrols({ id: patrolId });
    return data[0] || null;
  }
  if (url === '/reports/guard-hourly') {
    return getGuardHourlyReport();
  }
  if (url === '/pedestrians/recent' || url === '/pedestrians/report') {
    return listPedestrians();
  }
  if (url === '/pedestrians/my-report') {
    return listPedestrians({ currentGuardOnly: true });
  }
  if (url === '/vehicles/recent' || url === '/vehicles/report') {
    return listVehicles();
  }
  if (url === '/vehicles/my-report') {
    return listVehicles({ currentGuardOnly: true });
  }
  if (url === '/incidents/recent') {
    return listIncidents();
  }
  if (url === '/obentries/recent') {
    return listObEntries();
  }
  if (url === '/shifts/active' || url === '/shifts/current') {
    return getCurrentShift(await getCurrentSiteId());
  }
  if (url === '/shifts/guards' || url === '/guards/available' || url === '/users/guards') {
    return listGuardProfiles(await getCurrentSiteId());
  }
  if (url === '/shifts/completed') {
    return listCompletedShifts();
  }
  if (url === '/guards/stats') {
    return getGuardsWithStatsData();
  }
  if (url.startsWith('/auth/guards/')) {
    const siteId = url.split('/auth/guards/')[1];
    return listGuardProfiles(siteId);
  }
  if (url === '/sites/mine') {
    return getMySiteRecord();
  }
  if (url === '/nfc/scans') {
    return listNfcScans();
  }

  throwApiError(`Unsupported GET route: ${url}`, 404);
}

async function handlePost(url, payload = {}) {
  if (url === '/auth/login') {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: payload.email,
      password: payload.password,
    });
    if (error) throwSupabaseError(error, 401);

    const profile = await getCurrentProfile();
    return {
      token: data.session?.access_token || null,
      user: profile,
    };
  }
  if (url === '/auth/logout') {
    const { error } = await supabase.auth.signOut();
    if (error) throwSupabaseError(error, 400);
    return { success: true };
  }
  if (url === '/auth/guard-login') {
    return { user: normaliseLocalGuard(GENERAL_GUARD) };
  }
  if (url === '/auth/guard-logout') {
    return { success: true };
  }
  if (url === '/pedestrians/entry') {
    return createPedestrian(payload);
  }
  if (url === '/vehicles/entry') {
    return createVehicle(payload);
  }
  if (url === '/incidents/report') {
    return createIncident(payload);
  }
  if (url === '/security-events') {
    return createSecurityEvent(payload);
  }
  if (url === '/obentries/create') {
    return createObEntry(payload);
  }
  if (url === '/shifts/start') {
    return startShiftRecord(payload);
  }
  if (url === '/patrols/start') {
    return createPatrolRecord(payload);
  }
  if (url === '/patrols/complete') {
    return completePatrolRecord(payload);
  }
  if (url === '/shifts/end') {
    return endShiftRecord(payload);
  }
  if (url === '/shifts/guards/add' || url === '/users/guards') {
    return createGuardProfile(payload);
  }
  if (url === '/nfc/scan') {
    return createNfcScan(payload);
  }
  if (url === '/nfc/register') {
    return registerNfcTag(payload);
  }

  throwApiError(`Unsupported POST route: ${url}`, 404);
}

async function handlePatch(url, payload = {}) {
  if (url.startsWith('/pedestrians/') && url.endsWith('/exit')) {
    const id = url.split('/pedestrians/')[1].split('/')[0];
    return markPedestrianExited(id);
  }
  if (url.startsWith('/vehicles/') && url.endsWith('/exit')) {
    const id = url.split('/vehicles/')[1].split('/')[0];
    return markVehicleExited(id);
  }
  if (url.startsWith('/users/guards/') && url.endsWith('/pin')) {
    const id = url.split('/users/guards/')[1].split('/')[0];
    return updateGuardPinRecord(id, payload.pin);
  }
  if (url.startsWith('/users/guards/') && url.endsWith('/toggle')) {
    const id = url.split('/users/guards/')[1].split('/')[0];
    return toggleGuardRecord(id, payload.is_active);
  }

  throwApiError(`Unsupported PATCH route: ${url}`, 404);
}

async function handlePut(url, payload = {}) {
  if (url === '/sites/mine') {
    return updateMySiteRecord(payload);
  }

  throwApiError(`Unsupported PUT route: ${url}`, 404);
}

const api = {
  async get(url) {
    return { data: await handleGet(url) };
  },
  async post(url, payload) {
    return { data: await handlePost(url, payload) };
  },
  async patch(url, payload) {
    return { data: await handlePatch(url, payload) };
  },
  async put(url, payload) {
    return { data: await handlePut(url, payload) };
  },
};

export const login = (credentials) => api.post('/auth/login', credentials);
export const logout = () => api.post('/auth/logout');
export const getCurrentUser = () => api.get('/auth/me');

export const getPatrols = () => api.get('/patrols').then((res) => res.data);
export const getPatrolById = (id) => api.get(`/patrols/${id}`).then((res) => res.data);
export const getGuardPatrolData = () => api.get('/patrols/dashboard').then((res) => res.data);
export const getGuardPatrolDataCombined = async () => {
  const [patrols, scanPoints] = await Promise.all([
    api.get('/patrols').then((res) => res.data),
    api.get('/patrols/points').then((res) => res.data),
  ]);
  return { patrols, scanPoints };
};

export const getGuardReport = () => api.get('/reports/guard-hourly').then((res) => res.data);
export const getRecentPedestrians = () => api.get('/pedestrians/recent').then((res) => res.data);
export const registerPedestrian = (data) => api.post('/pedestrians/entry', data).then((res) => res.data);
export const getPedestrianReport = () => api.get('/pedestrians/report').then((res) => res.data);

export const getRecentVehicles = () => api.get('/vehicles/recent').then((res) => res.data);
export const registerVehicle = (data) => api.post('/vehicles/entry', data).then((res) => res.data);
export const getVehicleReport = () => api.get('/vehicles/report').then((res) => res.data);

export const getRecentIncidents = () => api.get('/incidents/recent').then((res) => res.data);
export const reportIncident = (data) => api.post('/incidents/report', data).then((res) => res.data);

export const getRecentOBEntries = () => api.get('/obentries/recent').then((res) => res.data);
export const createOBEntry = (data) => api.post('/obentries/create', data).then((res) => res.data);
export const saveIncident = (data) => api.post('/incidents/report', data).then((res) => res.data);

export const getActiveShift = () => api.get('/shifts/active').then((res) => res.data);
export const getGuardsList = () => api.get('/shifts/guards').then((res) => res.data);
export const startShift = (data) => api.post('/shifts/start', data).then((res) => res.data);
export const endShift = (data) => api.post('/shifts/end', data).then((res) => res.data);
export const addGuard = (data) => api.post('/shifts/guards/add', data).then((res) => res.data);
export const getCompletedShifts = () => api.get('/shifts/completed').then((res) => res.data);

export const getGuardPatrols = () => api.get('/patrols/my-patrols').then((res) => res.data);
export const getPatrolsByGuard = (guardId) => api.get(`/patrols/guard/${guardId}`).then((res) => res.data);
export const getGuardCheckpoints = () => api.get('/patrols/my-checkpoints').then((res) => res.data);
export const getGuardDashboardData = () => api.get('/patrols/dashboard').then((res) => res.data);
export const getMyPedestrianReport = () => api.get('/pedestrians/my-report').then((res) => res.data);
export const getMyVehicleReport = () => api.get('/vehicles/my-report').then((res) => res.data);

export const getGuardsWithStats = () => api.get('/guards/stats').then((res) => res.data);
export const markPedestrianExit = (id) => api.patch(`/pedestrians/${id}/exit`).then((res) => res.data);
export const markVehicleExit = (id) => api.patch(`/vehicles/${id}/exit`).then((res) => res.data);

export const getGuardsBySite = (siteId) => api.get(`/auth/guards/${siteId}`).then((res) => res.data);
export const guardLogin = (data) => api.post('/auth/guard-login', data);
export const guardLogout = () => api.post('/auth/guard-logout');

export const getGuards = () => api.get('/users/guards').then((res) => res.data);
export const addGuardUser = (data) => api.post('/users/guards', data).then((res) => res.data);
export const updateGuardPin = (id, pin) => api.patch(`/users/guards/${id}/pin`, { pin }).then((res) => res.data);
export const toggleGuardActive = (id, is_active) => api.patch(`/users/guards/${id}/toggle`, { is_active }).then((res) => res.data);

export const getMySite = () => api.get('/sites/mine').then((res) => res.data);
export const updateMySite = (data) => api.put('/sites/mine', data).then((res) => res.data);

export const logNFCScan = (data) => api.post('/nfc/scan', data).then((res) => res.data);
export const registerNFCTag = (data) => api.post('/nfc/register', data).then((res) => res.data);
export const getNFCCheckpoints = () => api.get('/nfc/checkpoints').then((res) => res.data);
export const getNFCScans = () => api.get('/nfc/scans').then((res) => res.data);

export default api;
