// Records that a guard left the NightGuard app while on duty.
//
// The guard is told this happens (see the on-duty banner on the home screen and the warning on the
// WhatsApp screen) — the point is the deterrent, not the catch.
//
// It is written as an OB entry, deliberately. The tables that look like a better fit are not
// writable by the app: RLS blocks inserts into `security_events`, `app_notification_events` and
// `device_patrol_data` for every profile the device can authenticate as, and they fail silently
// with a 400. The Occurrence Book is the one channel that both syncs and lands in front of an
// admin, and a guard walking away from the app IS an occurrence.
//
// NOTHING IS WRITTEN WHEN THE APP GOES AWAY. Android backgrounds the app for plenty of things that
// are not a guard walking off: a permission dialog, the NFC prompt, the notification shade, the
// screen timing out. Logging on the background event itself produced a stream of near-identical
// entries — six on one handset in a single morning, two of them 13 seconds apart — which is noise
// in a permanent record, and it queued a write every time, so the sync banner flickered on every
// app open for no reason a user could understand.
//
// Instead the departure is only MARKED when the app goes away, and the entry is written when the
// app comes back — or on the next launch, if Android killed it while it was away. The marker is a
// synchronous localStorage write, so it survives the process being killed. The resulting entry is
// better for the delay: it can say how long the guard was actually gone.

import { enqueueOfflineItem, syncOfflineQueueNow } from '../hooks/useOfflineQueue';
import { getCachedSiteSettings, getShiftSession } from './deviceStore';
import KioskService from '../services/kioskService';

const AWAY_MARKER_KEY = 'nightguard_app_left_at';

// Below this, the guard did not leave — the phone did something. An admin reading the OB wants
// departures worth asking about, not a log of every dialog Android put on the screen.
const MIN_AWAY_MS = 60000;

function clockTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function describeAway(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Note that the app has gone to the background. Writes nothing anywhere except this device.
 *
 * The shift, guard and kiosk state are captured HERE rather than on return: by the time the app
 * comes back the shift may have ended or been handed to someone else, and the entry has to name
 * whoever actually walked away.
 */
export function markAppBackgrounded({ user } = {}) {
  const shift = getShiftSession();
  // Off duty, the device is nobody's responsibility — there is nothing to report.
  if (!shift) return null;

  const marker = {
    at: Date.now(),
    shiftId: shift.id || null,
    siteId: getCachedSiteSettings().id || shift.siteId || null,
    guardId: shift.activeGuardId || user?.id || null,
    capturedBy: user?.id || null,
    guardName: shift.activeGuardName || user?.full_name || 'Guard',
    // Leaving a device that was supposed to be locked is a different event from leaving one the
    // admin deliberately unlocked, so the admin gets to see which happened.
    kiosk: KioskService.isEnabled(),
    // ...and a guard who tapped WhatsApp and was let out by the app is a third thing again.
    // Reporting that as "the device lock was bypassed" would put a security incident in the
    // Occurrence Book for a trip the app itself authorised.
    authorised: KioskService.isSuspended(),
  };

  try {
    localStorage.setItem(AWAY_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // Nothing to fall back to; a departure we cannot mark is a departure we cannot report.
    return null;
  }
  return marker;
}

/**
 * Called when the app comes back to the foreground, and once on launch to catch the case where
 * Android killed it while the guard was away. Writes at most one entry, and only if the guard was
 * gone long enough for it to mean anything.
 */
export function reconcileAppDeparture() {
  let marker = null;
  try {
    const raw = localStorage.getItem(AWAY_MARKER_KEY);
    if (!raw) return null;
    marker = JSON.parse(raw);
  } catch {
    // Unreadable marker: drop it rather than leaving it to fail on every future resume.
  }

  // Clear FIRST, so a double resume event cannot log the same departure twice.
  try {
    localStorage.removeItem(AWAY_MARKER_KEY);
  } catch { /* best effort */ }

  if (!marker?.at) return null;

  const awayMs = Date.now() - Number(marker.at);
  // Negative means the clock moved (timezone change, NTP correction). Not evidence of anything.
  if (!Number.isFinite(awayMs) || awayMs < MIN_AWAY_MS) return null;

  const left = new Date(Number(marker.at));
  const back = new Date();
  const context = marker.authorised
    ? 'opened WhatsApp from the app — the lock was released for the trip and re-applied on return'
    : marker.kiosk
      ? 'kiosk mode was ON — the device lock was bypassed'
      : 'kiosk mode is off for this device';

  const payload = {
    site_id: marker.siteId || null,
    shift_id: marker.shiftId || null,
    captured_by: marker.capturedBy || null,
    guard_id: marker.guardId || null,
    nature_of_occurrence:
      `${marker.guardName} left the NightGuard app at ${clockTime(left)} and returned at ` +
      `${clockTime(back)} — away ${describeAway(awayMs)} (${context}).`,
    captured_timestamp: left.toISOString(),
  };

  enqueueOfflineItem('post', '/obentries/create', payload, `ob_left_${marker.at}`);
  syncOfflineQueueNow().catch(() => null);

  return payload;
}
