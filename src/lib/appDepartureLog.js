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

import { enqueueOfflineItem, syncOfflineQueueNow } from '../hooks/useOfflineQueue';
import { getCachedSiteSettings, getShiftSession } from './deviceStore';
import KioskService from '../services/kioskService';

// Android fires appStateChange for transient things (permission dialogs, the share sheet). One
// entry per departure is the useful signal; a burst of them is noise the admin will learn to skip.
const DEBOUNCE_MS = 5000;
let lastRecordedAt = 0;

function clockTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Log a departure. Safe to call on every background event: it no-ops when no shift is running.
 * Returns the queued payload, or null when nothing was recorded.
 */
export function recordAppLeft({ user } = {}) {
  const shift = getShiftSession();
  // Off duty, the device is nobody's responsibility — there is nothing to report.
  if (!shift) return null;

  const now = Date.now();
  if (now - lastRecordedAt < DEBOUNCE_MS) return null;
  lastRecordedAt = now;

  const at = new Date();
  const guardName = shift.activeGuardName || user?.full_name || 'Guard';
  // Leaving a device that was supposed to be locked is a different event from leaving one the
  // admin deliberately unlocked, so the admin gets to see which happened.
  const context = KioskService.isEnabled()
    ? 'kiosk mode was ON — the device lock was bypassed'
    : 'kiosk mode is off for this device';

  const payload = {
    site_id: getCachedSiteSettings().id || shift.siteId || null,
    shift_id: shift.id || null,
    captured_by: user?.id || null,
    guard_id: shift.activeGuardId || user?.id || null,
    nature_of_occurrence: `${guardName} left the NightGuard app at ${clockTime(at)} (${context}).`,
    captured_timestamp: at.toISOString(),
  };

  // Queue FIRST — a synchronous localStorage write that survives Android freezing or killing the
  // process the moment it goes to the background. Then try to push it straight away, so a device
  // with signal reports the departure as it happens rather than when the guard comes back.
  enqueueOfflineItem('post', '/obentries/create', payload, `ob_left_${now}`);
  syncOfflineQueueNow().catch(() => null);

  return payload;
}
