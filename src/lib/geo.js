// Geolocation helpers for GPS patrols.
//
// A checkpoint counts as "reached" when the guard is physically close to it — within
// GEOFENCE_RADIUS_METERS (~5 m, i.e. standing at the point). A small accuracy margin (capped at
// ACCURACY_MARGIN_CAP_METERS) forgives GPS jitter for a guard who is genuinely at the point, and
// fixes worse than MAX_ACCEPTABLE_ACCURACY_METERS are rejected outright so a bad reading can
// never credit a check-in from far away.

export const GEOFENCE_RADIUS_METERS = 5;
export const MAX_ACCEPTABLE_ACCURACY_METERS = 25;
export const ACCURACY_MARGIN_CAP_METERS = 5;

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// A latitude/longitude pair that is finite, in range, and not the "null island" (0,0) default.
export function isValidCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export function hasCoordinates(checkpoint) {
  return Boolean(checkpoint) && isValidCoordinate(checkpoint.latitude, checkpoint.longitude);
}

// Haversine great-circle distance in metres.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(Number(value)))) {
    return Infinity;
  }
  const dLat = toRadians(Number(lat2) - Number(lat1));
  const dLng = toRadians(Number(lng2) - Number(lng1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(Number(lat1))) *
      Math.cos(toRadians(Number(lat2))) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// Nearest GPS-enabled checkpoint to a position. Returns { checkpoint, distance } or null.
export function findNearestCheckpoint(checkpoints, latitude, longitude) {
  const candidates = (Array.isArray(checkpoints) ? checkpoints : []).filter(hasCoordinates);
  if (!candidates.length || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return null;
  }

  let best = null;
  candidates.forEach((checkpoint) => {
    const distance = distanceMeters(
      latitude,
      longitude,
      Number(checkpoint.latitude),
      Number(checkpoint.longitude)
    );
    if (!best || distance < best.distance) {
      best = { checkpoint, distance };
    }
  });
  return best;
}

// Whether a position/accuracy pair is inside a checkpoint's geofence and trustworthy enough to log.
// The effective radius grows with the fix's reported accuracy (capped) so an honest guard at the
// point is credited despite GPS jitter, while clearly unreliable fixes are rejected outright.
export function isWithinGeofence(distance, accuracy, radius = GEOFENCE_RADIUS_METERS) {
  if (!Number.isFinite(distance)) return false;
  const acc = Number(accuracy);
  if (Number.isFinite(acc) && acc > MAX_ACCEPTABLE_ACCURACY_METERS) return false;
  const margin = Number.isFinite(acc) ? Math.min(Math.max(acc, 0), ACCURACY_MARGIN_CAP_METERS) : 0;
  return distance <= radius + margin;
}
