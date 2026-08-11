import { distanceMeters, estimateStepsFromDistance, routeDistanceMeters } from './geo';
import { enqueueOfflineItem } from '../hooks/useOfflineQueue';
import { upsertCachedPatrol } from './deviceStore';

// Persistent patrol session state.
//
// A patrol is a durable session, not component state: it survives navigating away, app restarts
// and phone reboots. While a session is active every GPS fix is appended to a breadcrumb route
// (the walk the guard took between points), and reached checkpoints are remembered so the guard
// can RESUME an unfinished patrol instead of silently losing it. Ended sessions are archived to
// a small local history (newest first) so the Patrol screen can show the last patrol route.

const ACTIVE_SESSION_KEY = 'nightguard_active_patrol_session';
const HISTORY_KEY = 'nightguard_patrol_history';
const OUTBOX_KEY = 'nightguard_patrol_outbox';
const HISTORY_LIMIT = 25;
const OUTBOX_LIMIT = 50;

// Fired whenever the active session changes on disk, so any screen showing patrol progress stays
// in step with the background recorder rather than only with its own local state.
export const PATROL_SESSION_EVENT = 'nightguard_patrol_session_updated';

// Route thinning: keep the trail light without losing the shape of the walk.
const MIN_POINT_DISTANCE_METERS = 6;
const MIN_POINT_INTERVAL_MS = 20000;
const MAX_ROUTE_POINTS = 700;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[PatrolSession] write failed for "${key}":`, err?.message || err);
  }
  return value;
}

export function generatePatrolId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122-ish fallback for old WebViews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getActivePatrolSession() {
  const session = readJson(ACTIVE_SESSION_KEY, null);
  return session && session.startedAt && !session.endedAt ? session : null;
}

export function saveActivePatrolSession(session) {
  writeJson(ACTIVE_SESSION_KEY, session);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PATROL_SESSION_EVENT));
  }
  return session;
}

export function startPatrolSession({ siteId = null, shiftId = null, guardId = null, guardName = 'Unknown guard', requiredCount = 0 } = {}) {
  const session = {
    id: generatePatrolId(),
    patrolName: `Patrol ${new Date().toLocaleString()}`,
    siteId,
    shiftId,
    guardId,
    guardName,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'in_progress',
    requiredCount,
    reachedCheckpointIds: [],
    route: [],
  };
  return saveActivePatrolSession(session);
}

// Append a GPS fix to the active session's breadcrumb trail (thinned). Returns the session.
export function appendRoutePoint(fix) {
  const session = getActivePatrolSession();
  if (!session || !Number.isFinite(Number(fix?.latitude)) || !Number.isFinite(Number(fix?.longitude))) {
    return session;
  }

  const point = {
    latitude: Number(fix.latitude),
    longitude: Number(fix.longitude),
    accuracy: Number.isFinite(Number(fix.accuracy)) ? Math.round(Number(fix.accuracy)) : null,
    at: new Date(fix.timestamp || Date.now()).toISOString(),
  };

  const last = session.route[session.route.length - 1];
  if (last) {
    const moved = distanceMeters(last.latitude, last.longitude, point.latitude, point.longitude);
    const elapsed = new Date(point.at) - new Date(last.at);
    if (moved < MIN_POINT_DISTANCE_METERS && elapsed < MIN_POINT_INTERVAL_MS) {
      return session;
    }
  }

  session.route.push(point);
  // Cap memory: if the trail gets huge, drop every other older point but keep the tail intact.
  if (session.route.length > MAX_ROUTE_POINTS) {
    const tail = session.route.slice(-100);
    session.route = session.route.slice(0, -100).filter((_, i) => i % 2 === 0).concat(tail);
  }
  return saveActivePatrolSession(session);
}

export function markCheckpointReached(checkpointId) {
  const session = getActivePatrolSession();
  if (!session || checkpointId == null) return session;
  const id = String(checkpointId);
  if (!session.reachedCheckpointIds.map(String).includes(id)) {
    session.reachedCheckpointIds.push(id);
    saveActivePatrolSession(session);
  }
  return session;
}

// The exact body /patrols/complete expects. Built from the session itself so a completion can be
// re-sent later without needing the screen that created it.
export function buildPatrolCompletionPayload(session, fallback = {}) {
  const completed = session.status === 'completed';
  // steps_taken used to be sent as the CHECKPOINT count, which the patrol report then printed as
  // "Steps" — a three-checkpoint patrol read "Steps: 3". It now carries a genuine estimate derived
  // from the distance actually walked.
  const distance = routeDistanceMeters(session.route);
  return {
    id: session.id,
    site_id: session.siteId || fallback.siteId || null,
    shift_id: session.shiftId || fallback.shiftId || null,
    guard_id: session.guardId || fallback.guardId || null,
    patrol_name: `${completed ? 'Patrol' : 'Incomplete patrol'} ${new Date(session.startedAt).toLocaleString()}`,
    actual_start: session.startedAt,
    actual_end: session.endedAt,
    status: session.status,
    steps_taken: estimateStepsFromDistance(distance),
    route: session.route || [],
  };
}

// What the device can say about a finished walk without any extra sensor or permission: how far,
// how long, and roughly how many steps that distance represents.
export function summarisePatrol(session) {
  if (!session) return null;
  const distance = routeDistanceMeters(session.route);
  const startedAt = new Date(session.startedAt).getTime();
  const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const durationMs = Math.max(endedAt - startedAt, 0);
  return {
    distanceMeters: Math.round(distance),
    estimatedSteps: estimateStepsFromDistance(distance),
    durationMs,
    routePoints: (session.route || []).length,
    checkpointsReached: (session.reachedCheckpointIds || []).length,
  };
}

export function formatDistance(metres) {
  const value = Number(metres) || 0;
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
}

export function formatDuration(ms) {
  const total = Math.max(Math.round(Number(ms) || 0), 0);
  const minutes = Math.floor(total / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes} min`;
  return `${Math.floor(total / 1000)}s`;
}

export function getPendingPatrolCompletions() {
  return readJson(OUTBOX_KEY, []);
}

// Called once the completion has been handed to the network layer (delivered, or durably queued).
export function resolvePendingPatrolCompletion(id) {
  const remaining = getPendingPatrolCompletions().filter((entry) => String(entry.id) !== String(id));
  return writeJson(OUTBOX_KEY, remaining);
}

// End the active session, archive it to history and return the finished session.
// `status` should be 'completed' or 'incomplete'.
export function endPatrolSession(status = 'completed', fallback = {}) {
  const session = getActivePatrolSession();
  if (!session) return null;
  session.endedAt = new Date().toISOString();
  session.status = status;

  // Built once and used for BOTH the outbox and the local cache below, so the number the guard
  // sees in "My Patrols" can never disagree with the one the server is given for the same patrol.
  const completion = buildPatrolCompletionPayload(session, fallback);

  // Park the ready-to-send completion BEFORE the active session is cleared. Android kills
  // backgrounded apps aggressively, and the old order (clear session -> then POST) meant a kill in
  // that gap lost the patrol and its entire walked route with nothing left to recover from.
  const pending = [
    { id: session.id, payload: completion, queuedAt: new Date().toISOString() },
    ...getPendingPatrolCompletions().filter((entry) => String(entry.id) !== String(session.id)),
  ].slice(0, OUTBOX_LIMIT);
  writeJson(OUTBOX_KEY, pending);

  localStorage.removeItem(ACTIVE_SESSION_KEY);

  // Show it in "My Patrols" straight away. Offline the server list is empty, and without this the
  // guard finished a walk and saw no trace of it until the device next reconnected.
  upsertCachedPatrol({
    id: session.id,
    site_id: session.siteId || fallback.siteId || null,
    shift_id: session.shiftId || fallback.shiftId || null,
    guard_id: session.guardId || fallback.guardId || null,
    patrol_name: session.patrolName,
    actual_start: session.startedAt,
    actual_end: session.endedAt,
    status: session.status,
    // steps_taken is the distance-derived step ESTIMATE everywhere (see estimateStepsFromDistance).
    // It used to be written here as the checkpoint count, so the same patrol showed one number in
    // "My Patrols" and a completely different one in the report and on the manager dashboard.
    // Checkpoint counts belong in the two fields below, which is where every reader looks for them.
    steps_taken: completion.steps_taken,
    checkpoints_completed: (session.reachedCheckpointIds || []).length,
    total_checkpoints: session.requiredCount || (session.reachedCheckpointIds || []).length,
    created_at: session.startedAt,
    _offline: true,
  });

  const history = [session, ...getPatrolHistory()].slice(0, HISTORY_LIMIT);
  writeJson(HISTORY_KEY, history);
  window.dispatchEvent(new Event('nightguard_patrol_history_updated'));
  window.dispatchEvent(new Event(PATROL_SESSION_EVENT));
  return session;
}

// Hand every unsent completion to the offline queue, which owns delivery from there. Safe to call
// repeatedly: the queue de-duplicates by endpoint + patrol id, and /patrols/complete upserts.
export function flushPendingPatrolCompletions() {
  const pending = getPendingPatrolCompletions();
  if (!pending.length) return 0;

  pending.forEach((entry) => {
    if (!entry?.payload?.id) return;
    enqueueOfflineItem('post', '/patrols/complete', entry.payload, entry.payload.id);
  });
  writeJson(OUTBOX_KEY, []);
  console.log(`[PatrolSession] flushPendingPatrolCompletions(): recovered ${pending.length} unsent patrol(s)`);
  return pending.length;
}

// A patrol nobody ended — the app was killed mid-shift, or the device was handed over without
// tapping End. Left alone the session sits active forever and its route never reaches the
// dashboard. Close it as incomplete so the walked route is still delivered.
export function closeAbandonedPatrolSession(maxAgeMs = 16 * 60 * 60 * 1000) {
  const session = getActivePatrolSession();
  if (!session) return null;
  if (Date.now() - new Date(session.startedAt).getTime() < maxAgeMs) return null;
  console.warn('[PatrolSession] closing abandoned patrol session:', session.id);
  return endPatrolSession('incomplete');
}

export function getPatrolHistory() {
  return readJson(HISTORY_KEY, []);
}

export function getLastPatrolSession() {
  return getPatrolHistory()[0] || null;
}
