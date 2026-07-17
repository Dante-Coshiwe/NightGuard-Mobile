import { distanceMeters } from './geo';

// Persistent patrol session state.
//
// A patrol is a durable session, not component state: it survives navigating away, app restarts
// and phone reboots. While a session is active every GPS fix is appended to a breadcrumb route
// (the walk the guard took between points), and reached checkpoints are remembered so the guard
// can RESUME an unfinished patrol instead of silently losing it. Ended sessions are archived to
// a small local history (newest first) so the Patrol screen can show the last patrol route.

const ACTIVE_SESSION_KEY = 'nightguard_active_patrol_session';
const HISTORY_KEY = 'nightguard_patrol_history';
const HISTORY_LIMIT = 5;

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
  return writeJson(ACTIVE_SESSION_KEY, session);
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

// End the active session, archive it to history and return the finished session.
// `status` should be 'completed' or 'incomplete'.
export function endPatrolSession(status = 'completed') {
  const session = getActivePatrolSession();
  if (!session) return null;
  session.endedAt = new Date().toISOString();
  session.status = status;
  localStorage.removeItem(ACTIVE_SESSION_KEY);

  const history = [session, ...getPatrolHistory()].slice(0, HISTORY_LIMIT);
  writeJson(HISTORY_KEY, history);
  window.dispatchEvent(new Event('nightguard_patrol_history_updated'));
  return session;
}

export function getPatrolHistory() {
  return readJson(HISTORY_KEY, []);
}

export function getLastPatrolSession() {
  return getPatrolHistory()[0] || null;
}
