import { findNearestCheckpoint, isWithinGeofence } from './geo';

// Shared patrol check-in logic used by both the home Patrol tab and the Patrol Tracking
// screen, so NFC and GPS behave identically regardless of which surface the guard uses.

// Match a scanned NFC tag to a configured checkpoint (case-insensitive), mirroring the
// original PatrolTab behaviour.
export function matchNfcCheckpoint(checkpoints, tagUid) {
  if (!tagUid) return null;
  const needle = String(tagUid).toLowerCase();
  return (
    (Array.isArray(checkpoints) ? checkpoints : []).find(
      (checkpoint) => checkpoint.tag_uid && String(checkpoint.tag_uid).toLowerCase() === needle
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
}) {
  const resolvedTag = method === 'nfc' ? tagUid || null : matchedCheckpoint?.tag_uid || null;

  return {
    id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    site_id: siteId,
    guard_id: guardId,
    shift_id: shiftId,
    patrol_id: patrolId,
    guard_name: guardName,
    shift_label: shiftLabel,
    scanned_at: new Date().toISOString(),
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
