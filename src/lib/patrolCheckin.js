import { findNearestCheckpoint, hasCoordinates, isWithinGeofence, segmentCrossedCheckpoint } from './geo';
import { normaliseTagUid } from './nfcReader';
import { newUuid } from './uuid';

// Shared patrol check-in logic used by both the home Patrol tab and the Patrol Tracking
// screen, so NFC and GPS behave identically regardless of which surface the guard uses.

// Match a scanned NFC tag to a configured checkpoint.
//
// Compared with separators stripped, not merely lower-cased: the native reader reports bare hex
// ("045a1b2c") while a tag_uid configured in the admin panel is commonly written with colons,
// dashes or spaces ("04:5A:1B:2C"). A plain case-insensitive compare failed those, and the guard
// holding a perfectly good tag against the phone got "unregistered checkpoint".
export function matchNfcCheckpoint(checkpoints, tagUid) {
  const needle = normaliseTagUid(tagUid);
  if (!needle) return null;
  return (
    (Array.isArray(checkpoints) ? checkpoints : []).find(
      (checkpoint) => checkpoint.tag_uid && normaliseTagUid(checkpoint.tag_uid) === needle
    ) || null
  );
}

// Evaluate a GPS fix against the checkpoint list. Returns the matched checkpoint only when
// the guard is inside the geofence AND the fix is accurate enough to be trusted.
export function evaluateGpsFix(checkpoints, position) {
  const nearest = findNearestCheckpoint(checkpoints, position?.latitude, position?.longitude);
  if (!nearest) {
    return {
      hasGpsCheckpoints: false,
      matchedCheckpoint: null,
      nearestCheckpoint: null,
      distance: Infinity,
      withinRange: false,
    };
  }

  const withinRange = isWithinGeofence(nearest.distance, position?.accuracy);
  return {
    hasGpsCheckpoints: true,
    matchedCheckpoint: withinRange ? nearest.checkpoint : null,
    nearestCheckpoint: nearest.checkpoint,
    distance: nearest.distance,
    withinRange,
  };
}

// Every checkpoint newly satisfied by this fix, considering both where the guard is now and the
// path walked since the previous fix. Most sites are GPS-only, so this is the primary way points
// get captured — a checkpoint missed here is a checkpoint missing from the report.
export function evaluateGpsProgress(checkpoints, previousFix, fix, reachedIds = []) {
  const reached = new Set((reachedIds || []).map(String));
  const candidates = (Array.isArray(checkpoints) ? checkpoints : []).filter(hasCoordinates);
  if (!candidates.length) return [];

  return candidates.filter((checkpoint) => {
    if (reached.has(String(checkpoint.id))) return false;

    const distance = findNearestCheckpoint([checkpoint], fix?.latitude, fix?.longitude)?.distance;
    if (Number.isFinite(distance) && isWithinGeofence(distance, fix?.accuracy)) return true;

    return segmentCrossedCheckpoint(checkpoint, previousFix, fix);
  });
}

function checkpointName(checkpoint, method) {
  return (
    checkpoint?.name ||
    checkpoint?.checkpoint_name ||
    (method === 'gps' ? 'Unregistered location' : 'Unregistered tag')
  );
}

// Build the /nfc/scan payload shared by NFC and GPS check-ins. `method` is 'nfc' or 'gps'.
export function buildPatrolScanEntry({
  method = 'nfc',
  tagUid = null,
  position = null,
  matchedCheckpoint = null,
  siteId = null,
  guardId = null,
  guardName = 'Unknown guard',
  shiftId = null,
  shiftLabel = 'Active Shift',
  patrolId = null,
  isOnline = true,
  // Captures recorded by the background service are handed over later, so they carry the moment
  // the guard was actually at the point rather than the moment the app got round to saving them.
  scannedAt = null,
}) {
  const resolvedTag = method === 'nfc' ? tagUid || null : matchedCheckpoint?.tag_uid || null;
  // A real UUID, not a `scan_...` string: the server writes it straight into nfc_scans.id, so a
  // queue retry after a response was lost in transit upserts the same row instead of logging the
  // guard at the same checkpoint twice.
  const scanId = newUuid();

  return {
    id: scanId,
    client_scan_id: scanId,
    site_id: siteId,
    guard_id: guardId,
    shift_id: shiftId,
    patrol_id: patrolId,
    guard_name: guardName,
    shift_label: shiftLabel,
    scanned_at: scannedAt || new Date().toISOString(),
    tag_uid: resolvedTag,
    checkpoint_id: matchedCheckpoint?.id || null,
    checkpoint_name: checkpointName(matchedCheckpoint, method),
    zone: matchedCheckpoint?.zone || 'Unknown zone',
    status: matchedCheckpoint ? 'matched' : 'unregistered',
    method,
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    location_accuracy: position?.accuracy ?? null,
    offline: !isOnline,
  };
}
