// ============================================================================
//  Patrol schedule: a window, not a list of times.
//
//  A site's schedule is really three numbers -- "first patrol at 19:00, last at
//  05:00, one every 30 minutes" -- but what is STORED, armed and reported against
//  is still the flat `patrol_times` array of "HH:MM" strings it expands to. That
//  is deliberate and must stay that way:
//
//    * `site_patrol_schedules.patrol_times` is what every APK already in the
//      field reads, what NotificationService arms one Android alarm per entry
//      from, and what PatrolScheduleAlert compares the wall clock against.
//      Nothing downstream had to change to get windows, and an old handset that
//      never learns the word "window" keeps working off the same list.
//    * So the window is DERIVED back out of the times (derivePatrolWindow), not
//      stored beside them. No migration, no second copy to fall out of step, and
//      a schedule someone hand-edited on an older build still opens here as the
//      window it most nearly is.
//
//  Mirrored twice, on purpose, because neither copy can import this file:
//  the manager dashboard (NightGuardTrackApp/frontend/public/index.html, the
//  `ngWindowTimes` / `ngDeriveWindow` pair) and the report mailer
//  (NightGuardTrackApp/supabase/functions/send-reports/schedule.ts). Change the
//  rules here and change them there, or a manager and a guard will read
//  different schedules off the same row.
// ============================================================================

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 1440;

// Every interval an operator can pick. Kept to divisors of an hour (and whole
// hours above that) so a window like 19:00 -> 05:00 lands on round times.
export const PATROL_INTERVAL_CHOICES = [15, 20, 30, 45, 60, 90, 120, 180, 240, 360];

// One Android alarm is armed per patrol time, and they are re-armed from scratch
// on every config save, every app launch and every APK upgrade. 96 is a patrol
// every 15 minutes around the clock -- past that the schedule is not a patrol
// round any more, and the alarm storm is a real cost on the handset.
export const MAX_PATROL_TIMES = 96;

export const DEFAULT_PATROL_WINDOW = { start: '19:00', end: '05:00', intervalMinutes: 60 };

export function isPatrolTime(value) {
  return HHMM.test(String(value ?? '').trim());
}

export function patrolTimeToMinutes(value) {
  const [h, m] = String(value).split(':').map(Number);
  return (h * 60) + m;
}

export function minutesToPatrolTime(minutes) {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function clampInterval(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 5) return DEFAULT_PATROL_WINDOW.intervalMinutes;
  return Math.min(n, 720);
}

// Sorted, de-duplicated, well-formed minutes-of-day. Anything unparseable is
// dropped rather than defaulted -- an unreadable time is not a patrol.
function toMinuteList(times) {
  const values = (Array.isArray(times) ? times : [])
    .map((time) => String(time ?? '').trim())
    .filter(isPatrolTime)
    .map(patrolTimeToMinutes);
  return [...new Set(values)].sort((a, b) => a - b);
}

// The window expanded into the times that actually get armed.
//
// The end is INCLUSIVE: "19:00 to 05:00 every 30 minutes" is understood as a last
// patrol at 05:00, not one at 04:30. An end that does not land on the interval
// simply stops at the last slot before it (19:00 -> 05:20 every 30 gives 05:00).
export function buildPatrolTimes(window = {}) {
  const interval = clampInterval(window.intervalMinutes);
  const start = isPatrolTime(window.start)
    ? patrolTimeToMinutes(window.start)
    : patrolTimeToMinutes(DEFAULT_PATROL_WINDOW.start);
  const end = isPatrolTime(window.end)
    ? patrolTimeToMinutes(window.end)
    : patrolTimeToMinutes(DEFAULT_PATROL_WINDOW.end);

  // An end BEFORE the start wraps through midnight, which is the normal case for
  // night cover. An end EQUAL to the start is one patrol a day -- not a full
  // circle. Round-the-clock cover is expressed by ending one interval short of
  // the start (00:00 -> 23:30 every 30 min), which is also exactly what
  // derivePatrolWindow hands back for an all-day list, so the two agree.
  const span = (((end - start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  const times = [];
  for (let offset = 0; offset <= span && times.length < MAX_PATROL_TIMES; offset += interval) {
    times.push(minutesToPatrolTime(start + offset));
  }
  return [...new Set(times)].sort();
}

// The window a list of times came from.
//
// Every patrol round leaves one gap wider than the rest -- the off-duty stretch
// between the last patrol of the night and the first of the next. Cut the circle
// there and what is left is the window: the time after the gap opens it, the time
// before it closes it, and the interval is how far apart the rest sit.
//
// `even` is false when the times are not evenly spaced (someone dropped a slot,
// or hand-edited the list on an older build). The window is then the closest
// honest description of it, not a promise that regenerating reproduces it.
export function derivePatrolWindow(times) {
  const minutes = toMinuteList(times);
  if (!minutes.length) return { ...DEFAULT_PATROL_WINDOW, even: false, count: 0 };
  if (minutes.length === 1) {
    const only = minutesToPatrolTime(minutes[0]);
    return { start: only, end: only, intervalMinutes: DEFAULT_PATROL_WINDOW.intervalMinutes, even: true, count: 1 };
  }

  // Wrapping the last back to the first closes the circle. The values are unique
  // and sorted, so no gap here can be zero.
  const gaps = minutes.map((value, index) => {
    const next = minutes[(index + 1) % minutes.length];
    return (((next - value) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  });

  let widest = 0;
  gaps.forEach((gap, index) => { if (gap > gaps[widest]) widest = index; });

  // No gap stands out, so there is no off-duty stretch: this is round-the-clock
  // cover. Read it left to right rather than cutting an arbitrary circle.
  const uniform = gaps.every((gap) => gap === gaps[0]);
  const startIndex = uniform ? 0 : (widest + 1) % minutes.length;
  const endIndex = uniform ? minutes.length - 1 : widest;

  const walked = uniform ? gaps.slice(0, -1) : gaps.filter((_, index) => index !== widest);
  const tally = new Map();
  walked.forEach((gap) => tally.set(gap, (tally.get(gap) || 0) + 1));
  let interval = walked[0] ?? DEFAULT_PATROL_WINDOW.intervalMinutes;
  tally.forEach((count, gap) => {
    const best = tally.get(interval) || 0;
    // Ties go to the shorter gap: it is the one the rest are multiples of.
    if (count > best || (count === best && gap < interval)) interval = gap;
  });

  return {
    start: minutesToPatrolTime(minutes[startIndex]),
    end: minutesToPatrolTime(minutes[endIndex]),
    intervalMinutes: interval,
    even: walked.every((gap) => gap === interval),
    count: minutes.length,
  };
}

// ── Scheduled versus walked ─────────────────────────────────────────────────
//
// Until now every patrol report counted patrols that HAPPENED. A schedule makes
// the other half measurable: the round that was due at 02:00 and never walked
// leaves no row anywhere, so it can only be found by asking the schedule what
// should have been there. That is what these two do, and it is the number the
// reports were missing.

// A patrol may start this many minutes BEFORE its slot and still count for it --
// a guard who sets off at 18:58 for the 19:00 round walked the 19:00 round. Never
// more than half the interval, so it can never reach back into the slot before.
const EARLY_START_GRACE_MINUTES = 10;

// Every scheduled slot that falls inside a period, as real timestamps.
//
// Times are wall-clock and the period is absolute, so this walks the days of the
// period rather than doing arithmetic on ISO strings: that keeps 02:00 meaning
// 02:00 on the night the clocks change.
export function buildScheduleSlots(times, from, to, limit = 5000) {
  const minutes = toMinuteList(times);
  const startMs = from instanceof Date ? from.getTime() : Number(from);
  const endMs = to instanceof Date ? to.getTime() : Number(to);
  if (!minutes.length || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const slots = [];
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  // One day of margin: a period opening at 19:00 still needs that evening's slots.
  for (let guard = 0; day.getTime() <= endMs && slots.length < limit; guard += 1) {
    if (guard > 400) break;
    for (const minute of minutes) {
      const at = new Date(day);
      at.setHours(0, minute, 0, 0);
      const ms = at.getTime();
      if (ms >= startMs && ms < endMs && slots.length < limit) {
        slots.push({ time: minutesToPatrolTime(minute), at });
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return slots.sort((a, b) => a.at - b.at);
}

// Which scheduled rounds were walked, which were missed, and which patrols
// answered to no slot at all.
//
// A patrol counts for the most recent slot at or before it (plus the early
// grace), and only while the next slot has not come round yet -- so one patrol
// can never satisfy two slots, and a patrol walked hours off schedule is
// reported as extra rather than quietly credited to a round nobody did.
export function matchPatrolsToSchedule(times, patrolStarts, from, to) {
  const slots = buildScheduleSlots(times, from, to).map((slot) => ({ ...slot, patrols: 0, firstStart: null }));
  const window = derivePatrolWindow(times);
  const intervalMs = Math.max(1, window.intervalMinutes) * 60000;
  const graceMs = Math.min(EARLY_START_GRACE_MINUTES, Math.floor(window.intervalMinutes / 2)) * 60000;

  let unscheduled = 0;
  const stamps = (Array.isArray(patrolStarts) ? patrolStarts : [])
    .map((value) => (value instanceof Date ? value.getTime() : new Date(value ?? NaN).getTime()))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);

  for (const ms of stamps) {
    // The last slot this patrol could belong to, early grace included.
    let index = -1;
    for (let i = slots.length - 1; i >= 0; i -= 1) {
      if (slots[i].at.getTime() - graceMs <= ms) { index = i; break; }
    }
    if (index === -1 || ms - slots[index].at.getTime() >= intervalMs) {
      unscheduled += 1;
    } else {
      // `stamps` is sorted, so the first patrol to land on a slot is the earliest.
      // Reports show how late a round ran, not just whether it happened.
      if (slots[index].patrols === 0) slots[index].firstStart = new Date(ms);
      slots[index].patrols += 1;
    }
  }

  const covered = slots.filter((slot) => slot.patrols > 0);
  return {
    slots,
    window,
    expected: slots.length,
    covered: covered.length,
    missed: slots.filter((slot) => slot.patrols === 0),
    unscheduled,
    // Null rather than 0 when there is no schedule: "0% adherent" and "nothing to
    // be adherent to" are different findings and must not print the same.
    percent: slots.length ? Math.round((covered.length / slots.length) * 100) : null,
  };
}

// The last round the window actually produces.
//
// It is not always the end that was typed: an interval that does not divide the
// window stops at the last whole step inside it (19:00 -> 05:00 every 2 h 37 min
// ends at 02:51, not 05:00). The editor keeps the typed end either way -- silently
// rewriting it to 02:51 would move the schedule under the operator's hands the
// moment they changed the interval -- so screens use this to say what will really
// be walked.
export function patrolWindowLastSlot(window = {}) {
  const times = buildPatrolTimes(window);
  if (!times.length) return null;
  const interval = clampInterval(window.intervalMinutes);
  const start = isPatrolTime(window.start)
    ? patrolTimeToMinutes(window.start)
    : patrolTimeToMinutes(DEFAULT_PATROL_WINDOW.start);
  const end = isPatrolTime(window.end)
    ? patrolTimeToMinutes(window.end)
    : patrolTimeToMinutes(DEFAULT_PATROL_WINDOW.end);
  const span = (((end - start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const steps = Math.min(Math.floor(span / interval), MAX_PATROL_TIMES - 1);
  return minutesToPatrolTime(start + steps * interval);
}

export function formatPatrolInterval(minutes) {
  const value = clampInterval(minutes);
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} hour${hours === 1 ? '' : 's'}`;
}

// "19:00 to 05:00, every 30 min (21 patrols a day)" -- the one line that says what
// a schedule is, used on the config screen, both patrol reports and the digest.
export function describePatrolWindow(window, count) {
  if (!window) return 'No patrol schedule set';
  const total = Number.isFinite(count) ? count : window.count;
  // A window that opens and closes on the same minute is one patrol a day, and
  // "every 60 min" would be a lie about a schedule that never repeats.
  if (window.start === window.end) return `One patrol a day, at ${window.start}`;
  const every = formatPatrolInterval(window.intervalMinutes);
  const slots = Number.isFinite(total) ? ` (${total} patrol${total === 1 ? '' : 's'} a day)` : '';
  return `${window.start} to ${window.end}, every ${every}${slots}`;
}

// How long the window runs for, as "10h" / "10h 30m". Answers "is this really the
// night shift?" without the reader doing midnight arithmetic in their head.
export function patrolWindowLength(window) {
  if (!window || !isPatrolTime(window.start) || !isPatrolTime(window.end)) return '';
  if (window.start === window.end) return '';
  const start = patrolTimeToMinutes(window.start);
  const end = patrolTimeToMinutes(window.end);
  const span = (((end - start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(span / 60);
  const mins = span % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}
