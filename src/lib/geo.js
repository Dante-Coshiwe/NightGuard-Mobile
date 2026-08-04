// Geolocation helpers for GPS patrols.
//
// A checkpoint counts as "reached" when the guard is physically close to it — within
// GEOFENCE_RADIUS_METERS (~10 m, i.e. at the point). A small accuracy margin (capped at
// ACCURACY_MARGIN_CAP_METERS) forgives GPS jitter for a guard who is genuinely at the point, and
// fixes worse than MAX_ACCEPTABLE_ACCURACY_METERS are rejected outright so a bad reading can
// never credit a check-in from far away.
//
// 1.0.16 tightened this to 3 m, which reads well on paper but not on a phone: a 3 m fence plus the
// 5 m margin cap gave an ~8 m effective radius, and consumer GPS beside a building is routinely
// worse than that. Guards walked whole routes that registered nothing. 10 m credits an honest
// walk-by on real hardware while staying far too tight to reach from a parked car.

export const GEOFENCE_RADIUS_METERS = 10;
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

// Initial great-circle bearing from one point to another, in degrees clockwise from true north.
export function bearingDegrees(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(Number(value)))) return null;
  const φ1 = toRadians(Number(lat1));
  const φ2 = toRadians(Number(lat2));
  const Δλ = toRadians(Number(lng2) - Number(lng1));
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const COMPASS_POINTS = [
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
];

// A compass word rather than a rotating arrow: an arrow is only meaningful if the phone's heading
// is known, and a WebView cannot read the magnetometer reliably. "Head north-east" is something a
// guard can act on with the phone flat in their hand.
export function compassDirection(degrees) {
  if (!Number.isFinite(Number(degrees))) return '';
  const index = Math.round(((Number(degrees) % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[index];
}

// The point the guard should walk to next: the closest one they have not gathered yet. Purely
// advisory — points may be gathered in ANY order, so this never gates or sequences anything.
export function nextCheckpointGuidance(checkpoints, reachedIds, position) {
  if (!isValidCoordinate(position?.latitude, position?.longitude)) return null;
  const reached = new Set((reachedIds || []).map(String));
  const remaining = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter((checkpoint) => hasCoordinates(checkpoint) && !reached.has(String(checkpoint.id)));
  if (!remaining.length) return null;

  const nearest = findNearestCheckpoint(remaining, position.latitude, position.longitude);
  if (!nearest) return null;

  const bearing = bearingDegrees(
    position.latitude, position.longitude,
    Number(nearest.checkpoint.latitude), Number(nearest.checkpoint.longitude),
  );
  return {
    checkpoint: nearest.checkpoint,
    distance: nearest.distance,
    bearing,
    direction: compassDirection(bearing),
  };
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

// Total ground distance walked along a recorded route, in metres.
//
// Route points are thinned (see patrolSession), so this reads slightly under the true path on a
// winding walk — it is an honest floor, not an exact odometer. Individual hops longer than
// MAX_SEGMENT_GAP_METERS are skipped: those are a GPS glitch or a resumed session, not walking.
export function routeDistanceMeters(route = []) {
  const points = (Array.isArray(route) ? route : []).filter((point) => (
    isValidCoordinate(point?.latitude, point?.longitude)
  ));
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const step = distanceMeters(
      points[i - 1].latitude, points[i - 1].longitude,
      points[i].latitude, points[i].longitude,
    );
    if (Number.isFinite(step) && step <= MAX_SEGMENT_GAP_METERS) total += step;
  }
  return total;
}

// Average walking stride. Used to turn measured distance into a step estimate — the phone has no
// pedometer available to the WebView, so this is derived from GPS, never counted.
export const AVERAGE_STRIDE_METERS = 0.75;

export function estimateStepsFromDistance(metres) {
  const value = Number(metres);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / AVERAGE_STRIDE_METERS);
}

// Perpendicular distance in metres from a point to the straight segment A->B, via a local
// equirectangular projection (sub-centimetre at patrol scale).
export function distanceToSegmentMeters(lat, lng, latA, lngA, latB, lngB) {
  if (![lat, lng, latA, lngA, latB, lngB].every((value) => Number.isFinite(Number(value)))) {
    return Infinity;
  }
  const metresPerDegreeLat = 111320;
  const metresPerDegreeLng = 111320 * Math.cos(toRadians(Number(lat)));

  const toXY = (la, ln) => ({
    x: (Number(ln) - Number(lng)) * metresPerDegreeLng,
    y: (Number(la) - Number(lat)) * metresPerDegreeLat,
  });

  const a = toXY(latA, lngA);
  const b = toXY(latB, lngB);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // Degenerate segment (the guard stood still): fall back to point distance.
  if (lengthSquared === 0) return Math.hypot(a.x, a.y);

  // Projection of the origin (the checkpoint) onto AB, clamped to the segment.
  const t = Math.max(0, Math.min(1, -((a.x * dx) + (a.y * dy)) / lengthSquared));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

// A GPS fix arrives every few seconds, so a guard walking past a checkpoint covers several metres
// between fixes and can step straight over a 3 m fence without a single fix ever landing inside it
// — the point silently reads as "missed". Checking the PATH between two consecutive fixes instead
// of each fix in isolation is what dedicated patrol trackers do, and it credits the guard who
// genuinely walked the route without widening the fence for someone who did not.
//
// Guard rails: both fixes must be trustworthy, and the gap must look like walking. A long jump
// (vehicle, GPS glitch, resumed after a pause) would otherwise credit every checkpoint on the
// straight line between two distant points.
export const MAX_SEGMENT_GAP_MS = 120000;
export const MAX_SEGMENT_GAP_METERS = 200;

export function segmentCrossedCheckpoint(checkpoint, previousFix, fix, radius = GEOFENCE_RADIUS_METERS) {
  if (!hasCoordinates(checkpoint) || !previousFix || !fix) return false;

  const previousAccuracy = Number(previousFix.accuracy);
  const accuracy = Number(fix.accuracy);
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return false;
  if (Number.isFinite(previousAccuracy) && previousAccuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return false;

  const elapsed = Math.abs(new Date(fix.at || fix.timestamp || Date.now()) - new Date(previousFix.at || previousFix.timestamp || Date.now()));
  if (elapsed > MAX_SEGMENT_GAP_MS) return false;

  const travelled = distanceMeters(previousFix.latitude, previousFix.longitude, fix.latitude, fix.longitude);
  if (!Number.isFinite(travelled) || travelled > MAX_SEGMENT_GAP_METERS) return false;

  const margin = Number.isFinite(accuracy) ? Math.min(Math.max(accuracy, 0), ACCURACY_MARGIN_CAP_METERS) : 0;
  const distance = distanceToSegmentMeters(
    Number(checkpoint.latitude), Number(checkpoint.longitude),
    Number(previousFix.latitude), Number(previousFix.longitude),
    Number(fix.latitude), Number(fix.longitude),
  );
  return distance <= radius + margin;
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
