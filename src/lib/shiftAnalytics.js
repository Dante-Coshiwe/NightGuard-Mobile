// ============================================================================
//  Shift analytics — the ONE place a shift number is derived.
//
//  Both shift reports used to read `shift.duration_hours`, `shift.duration_minutes`,
//  `shift.duration_ms` and `shift.is_sunday` straight off the row. Nothing has ever
//  written those columns: the `shifts` table stores `started_at` / `ended_at` and
//  nothing else about length. So every duration rendered as "undefinedm", the total
//  hours tile read 0h, and the guard rollup added zeroes together. Durations are
//  DERIVED here, at read time, from the two timestamps that actually exist.
//
//  Attribution: a record belongs to a shift if it carries that `shift_id`, and
//  otherwise if its timestamp falls inside the shift window. The fallback matters —
//  `shift_id` is null on a lot of history (the local `shift_<ts>` id is dropped by
//  `nullableUuid()` until the server id is adopted, see reconcileShiftSessionId), so
//  an id-only join reports "0 patrols" for shifts that were in fact fully walked.
// ============================================================================

export const UNATTRIBUTED_GUARD = 'Unassigned guard';

// A shift left open by a guard who never tapped End Shift, then closed by the next
// startShiftRecord on the same handset, is not a worked shift — it is a data
// artefact. It is reported separately so site hours are not inflated by it.
const ARTEFACT_END_REASONS = new Set(['superseded_by_new_shift', 'abandoned_backfill']);

// Nobody works 16 hours on a gate. Anything longer is a shift that was never ended
// and got closed later by something else; counting it as time on site would put
// hundreds of phantom hours in front of the client.
export const IMPLAUSIBLE_SHIFT_MS = 16 * 60 * 60 * 1000;

function toTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatHours(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0h';
  return `${(ms / 3600000).toFixed(1)}h`;
}

export function formatDateTime(value) {
  const time = toTime(value);
  if (!time) return '—';
  return new Date(time).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function endStatusOf(shift, durationMs) {
  const reason = String(shift.end_reason || '').trim();
  if (ARTEFACT_END_REASONS.has(reason)) {
    return {
      key: 'auto_closed',
      label: 'Auto-closed',
      detail: reason === 'abandoned_backfill'
        ? 'Left open and closed during cleanup'
        : 'Left open, closed when the next shift started',
      counts: false,
    };
  }
  if (!shift.ended_at) {
    return { key: 'open', label: 'Still open', detail: 'No end time recorded', counts: false };
  }
  if (durationMs > IMPLAUSIBLE_SHIFT_MS) {
    return {
      key: 'over_length',
      label: 'Over-length',
      detail: `Ran ${formatHours(durationMs)} — End Shift was almost certainly never tapped`,
      counts: false,
    };
  }
  if (reason === 'universal_pin') {
    return { key: 'ended', label: 'Ended (universal PIN)', detail: 'Unlocked with the manager fallback PIN', counts: true };
  }
  return { key: 'ended', label: 'Ended normally', detail: 'Guard signed off on the device', counts: true };
}

// Turn one `shifts` row into everything a report needs to show about it.
export function deriveShiftMetrics(shift = {}) {
  const startedAt = shift.started_at || shift.start_time || null;
  const endedAt = shift.ended_at || shift.end_time || null;
  const startTime = toTime(startedAt);
  const endTime = toTime(endedAt);
  const durationMs = startTime && endTime && endTime > startTime ? endTime - startTime : 0;
  const start = startTime ? new Date(startTime) : null;
  const end = endTime ? new Date(endTime) : null;
  const endStatus = endStatusOf(shift, durationMs);

  return {
    id: shift.id,
    guardName: shift.guard_name || UNATTRIBUTED_GUARD,
    shiftName: shift.shift_name || 'Shift',
    startedAt,
    endedAt,
    startTime,
    endTime,
    durationMs,
    // Only shifts that ended plausibly contribute to hours on site. An over-length
    // or auto-closed row is still LISTED — it is evidence of a handover problem —
    // but it must not be added to a number the client is invoiced against.
    billableMs: endStatus.counts ? durationMs : 0,
    isSunday: Boolean(start && start.getDay() === 0),
    // Night cover is what most of these contracts are for, so it is worth counting:
    // a shift that starts at or after 18:00, or before 04:00.
    isNightShift: Boolean(start && (start.getHours() >= 18 || start.getHours() < 4)),
    crossesMidnight: Boolean(start && end && start.toDateString() !== end.toDateString()),
    endStatus,
  };
}

function inWindow(time, startTime, endTime) {
  if (!time || !startTime) return false;
  if (time < startTime) return false;
  return endTime ? time <= endTime : true;
}

// Index a set of records by the shift they belong to. `timeField` names the column
// that says when it happened; the first one present on the row wins.
function attributeToShifts(records, shifts, timeFields) {
  const byShiftId = new Map(shifts.map((shift) => [String(shift.id), []]));
  const windows = shifts
    .filter((shift) => shift.startTime)
    .sort((a, b) => b.startTime - a.startTime);

  (records || []).forEach((record) => {
    if (!record) return;
    const directKey = String(record.shift_id || '');
    if (directKey && byShiftId.has(directKey)) {
      byShiftId.get(directKey).push(record);
      return;
    }
    const stamp = timeFields.map((field) => toTime(record[field])).find(Boolean);
    if (!stamp) return;
    const owner = windows.find((shift) => inWindow(stamp, shift.startTime, shift.endTime));
    if (owner) byShiftId.get(String(owner.id))?.push(record);
  });

  return byShiftId;
}

function isCompletedPatrol(patrol) {
  return patrol?.status === 'completed' || patrol?.status === 'complete' || Boolean(patrol?.acknowledged);
}

function distinctCheckpoints(scans) {
  return new Set(
    (scans || [])
      .map((scan) => String(scan.checkpoint_id || scan.checkpoint_name || scan.point_name || '').trim().toLowerCase())
      .filter(Boolean),
  ).size;
}

// Build the full report: every completed shift with what actually happened during it,
// plus period totals. `checkpointsConfigured` is how many patrol points the site has
// set up — without it, "coverage" has no denominator and always reads 100%.
export function buildShiftReport({
  shifts = [],
  patrols = [],
  scans = [],
  incidents = [],
  vehicles = [],
  pedestrians = [],
  obEntries = [],
  checkpointsConfigured = 0,
} = {}) {
  const derived = shifts
    .map(deriveShiftMetrics)
    .filter((shift) => shift.startTime)
    .sort((a, b) => b.startTime - a.startTime);

  const patrolsByShift = attributeToShifts(patrols, derived, ['actual_start', 'created_at', 'scheduled_time']);
  const scansByShift = attributeToShifts(scans, derived, ['scanned_at', 'created_at']);
  const incidentsByShift = attributeToShifts(incidents, derived, ['reported_at', 'created_at']);
  const vehiclesByShift = attributeToShifts(vehicles, derived, ['entered_at', 'created_at']);
  const pedestriansByShift = attributeToShifts(pedestrians, derived, ['entry_time', 'created_at']);
  const obByShift = attributeToShifts(obEntries, derived, ['captured_timestamp', 'created_at']);

  const rows = derived.map((shift) => {
    const key = String(shift.id);
    const shiftPatrols = patrolsByShift.get(key) || [];
    const shiftScans = scansByShift.get(key) || [];
    const pointsVisited = distinctCheckpoints(shiftScans);

    return {
      ...shift,
      patrols: shiftPatrols.length,
      patrolsCompleted: shiftPatrols.filter(isCompletedPatrol).length,
      checkpointScans: shiftScans.length,
      pointsVisited,
      // Of the points this site has configured, how many were reached at least once
      // during the shift. Capped: a point can be visited many times in a night.
      coveragePercent: checkpointsConfigured
        ? Math.min(100, Math.round((pointsVisited / checkpointsConfigured) * 100))
        : null,
      incidents: (incidentsByShift.get(key) || []).length,
      vehicles: (vehiclesByShift.get(key) || []).length,
      pedestrians: (pedestriansByShift.get(key) || []).length,
      obEntries: (obByShift.get(key) || []).length,
    };
  });

  return { rows, checkpointsConfigured };
}

// Period totals for the header of either report. Everything here is computed from
// the SAME rows the table below it renders, so a tile can never contradict the list.
export function summariseShiftRows(rows = [], checkpointsConfigured = 0) {
  const counted = rows.filter((row) => row.endStatus.counts);
  const totalMs = counted.reduce((acc, row) => acc + row.billableMs, 0);
  const pointsVisited = rows.reduce((acc, row) => acc + row.pointsVisited, 0);
  const expectedPoints = checkpointsConfigured * rows.reduce((acc, row) => acc + Math.max(row.patrols, 0), 0);

  return {
    shifts: rows.length,
    countedShifts: counted.length,
    flaggedShifts: rows.length - counted.length,
    totalMs,
    averageMs: counted.length ? Math.round(totalMs / counted.length) : 0,
    sundayShifts: rows.filter((row) => row.isSunday).length,
    nightShifts: rows.filter((row) => row.isNightShift).length,
    patrols: rows.reduce((acc, row) => acc + row.patrols, 0),
    patrolsCompleted: rows.reduce((acc, row) => acc + row.patrolsCompleted, 0),
    checkpointScans: rows.reduce((acc, row) => acc + row.checkpointScans, 0),
    pointsVisited,
    // Patrol points reached against points that should have been reached across
    // every patrol in the period. Null when the site has no points configured —
    // showing 100% there would be a lie dressed as a KPI.
    coveragePercent: expectedPoints ? Math.min(100, Math.round((pointsVisited / expectedPoints) * 100)) : null,
    incidents: rows.reduce((acc, row) => acc + row.incidents, 0),
    vehicles: rows.reduce((acc, row) => acc + row.vehicles, 0),
    pedestrians: rows.reduce((acc, row) => acc + row.pedestrians, 0),
    obEntries: rows.reduce((acc, row) => acc + row.obEntries, 0),
  };
}

// Per-guard rollup for the client report. Same inputs, same rules — it is a GROUP BY
// over the rows above rather than a second, independently-computed set of numbers.
export function rollUpByGuard(rows = []) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = row.guardName || UNATTRIBUTED_GUARD;
    if (!grouped.has(key)) {
      grouped.set(key, {
        guardName: key,
        shifts: 0,
        countedShifts: 0,
        flaggedShifts: 0,
        totalMs: 0,
        sundayShifts: 0,
        nightShifts: 0,
        patrols: 0,
        patrolsCompleted: 0,
        pointsVisited: 0,
        incidents: 0,
        vehicles: 0,
        pedestrians: 0,
        obEntries: 0,
        firstShiftAt: row.startTime,
        lastShiftAt: row.startTime,
      });
    }
    const entry = grouped.get(key);
    entry.shifts += 1;
    if (row.endStatus.counts) entry.countedShifts += 1; else entry.flaggedShifts += 1;
    entry.totalMs += row.billableMs;
    if (row.isSunday) entry.sundayShifts += 1;
    if (row.isNightShift) entry.nightShifts += 1;
    entry.patrols += row.patrols;
    entry.patrolsCompleted += row.patrolsCompleted;
    entry.pointsVisited += row.pointsVisited;
    entry.incidents += row.incidents;
    entry.vehicles += row.vehicles;
    entry.pedestrians += row.pedestrians;
    entry.obEntries += row.obEntries;
    entry.firstShiftAt = Math.min(entry.firstShiftAt, row.startTime);
    entry.lastShiftAt = Math.max(entry.lastShiftAt, row.startTime);
  });

  return [...grouped.values()].sort((a, b) => b.totalMs - a.totalMs);
}

// Coverage by day, so a stakeholder can see the gaps rather than a single average.
// A day with no shift at all is the thing worth spotting, so empty days are emitted.
export function buildDailyCoverage(rows = [], { maxDays = 31 } = {}) {
  if (!rows.length) return [];

  const byDay = new Map();
  rows.forEach((row) => {
    const key = new Date(row.startTime).toDateString();
    if (!byDay.has(key)) {
      byDay.set(key, { date: new Date(row.startTime), ms: 0, shifts: 0, incidents: 0, patrols: 0 });
    }
    const day = byDay.get(key);
    day.ms += row.billableMs;
    day.shifts += 1;
    day.incidents += row.incidents;
    day.patrols += row.patrols;
  });

  const newest = Math.max(...rows.map((row) => row.startTime));
  // Compare against the START of the oldest day, not the oldest timestamp — a shift
  // that began at 06:00 sits after midnight of its own day, so stopping at the raw
  // timestamp dropped the earliest day out of the chart entirely.
  const oldestDay = new Date(Math.min(...rows.map((row) => row.startTime)));
  oldestDay.setHours(0, 0, 0, 0);

  const days = [];
  const cursor = new Date(newest);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < maxDays; i += 1) {
    const key = cursor.toDateString();
    const found = byDay.get(key);
    days.push(found || { date: new Date(cursor), ms: 0, shifts: 0, incidents: 0, patrols: 0 });
    if (cursor.getTime() <= oldestDay.getTime()) break;
    cursor.setDate(cursor.getDate() - 1);
  }

  return days.reverse();
}
