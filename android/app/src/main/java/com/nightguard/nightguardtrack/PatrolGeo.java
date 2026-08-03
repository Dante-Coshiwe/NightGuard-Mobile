package com.nightguard.nightguardtrack;

/**
 * Checkpoint matching maths, kept deliberately identical to src/lib/geo.js.
 *
 * The background service has to credit exactly the same checkpoints the in-app recorder would,
 * otherwise a patrol walked with the screen off would score differently from the same walk with
 * the screen on. Every constant and rule here has a counterpart in geo.js — change them together.
 */
final class PatrolGeo {
    /** A checkpoint counts as reached when the guard is this close (metres). */
    static final double GEOFENCE_RADIUS_METERS = 3;
    /** Fixes worse than this are never trusted to credit a check-in. */
    static final double MAX_ACCEPTABLE_ACCURACY_METERS = 25;
    /** How much GPS jitter is forgiven for a guard genuinely at the point. */
    static final double ACCURACY_MARGIN_CAP_METERS = 5;
    /** A gap longer than this between fixes is not walking, so no path is inferred across it. */
    static final long MAX_SEGMENT_GAP_MS = 120000;
    static final double MAX_SEGMENT_GAP_METERS = 200;

    private static final double EARTH_RADIUS_METERS = 6371000;

    private PatrolGeo() {}

    static boolean isValidCoordinate(double lat, double lng) {
        return !Double.isNaN(lat) && !Double.isNaN(lng)
            && lat >= -90 && lat <= 90
            && lng >= -180 && lng <= 180
            && !(lat == 0 && lng == 0);
    }

    /** Haversine great-circle distance in metres. */
    static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** How far the accuracy of a fix is allowed to stretch the fence. */
    private static double margin(double accuracy) {
        if (Double.isNaN(accuracy)) return 0;
        return Math.min(Math.max(accuracy, 0), ACCURACY_MARGIN_CAP_METERS);
    }

    /** Inside the fence and trustworthy enough to log. Mirrors isWithinGeofence(). */
    static boolean isWithinGeofence(double distance, double accuracy) {
        if (Double.isNaN(distance) || Double.isInfinite(distance)) return false;
        if (!Double.isNaN(accuracy) && accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return false;
        return distance <= GEOFENCE_RADIUS_METERS + margin(accuracy);
    }

    /**
     * Perpendicular distance from a point to the segment A->B, via a local equirectangular
     * projection. Mirrors distanceToSegmentMeters().
     */
    static double distanceToSegmentMeters(double lat, double lng,
                                          double latA, double lngA,
                                          double latB, double lngB) {
        double metresPerDegreeLat = 111320;
        double metresPerDegreeLng = 111320 * Math.cos(Math.toRadians(lat));

        double ax = (lngA - lng) * metresPerDegreeLng;
        double ay = (latA - lat) * metresPerDegreeLat;
        double bx = (lngB - lng) * metresPerDegreeLng;
        double by = (latB - lat) * metresPerDegreeLat;

        double dx = bx - ax;
        double dy = by - ay;
        double lengthSquared = dx * dx + dy * dy;

        // Degenerate segment (the guard stood still): fall back to point distance.
        if (lengthSquared == 0) return Math.hypot(ax, ay);

        double t = Math.max(0, Math.min(1, -((ax * dx) + (ay * dy)) / lengthSquared));
        return Math.hypot(ax + t * dx, ay + t * dy);
    }

    /**
     * Did the path walked between two consecutive fixes pass through the checkpoint?
     *
     * A guard walking at pace covers several metres between fixes and can step straight over a 3 m
     * fence without a single fix landing inside it. Checking the PATH is what credits that guard
     * without widening the fence for someone who never went there. Mirrors segmentCrossedCheckpoint().
     */
    static boolean segmentCrossedCheckpoint(double checkpointLat, double checkpointLng,
                                            double prevLat, double prevLng, double prevAccuracy, long prevAt,
                                            double lat, double lng, double accuracy, long at) {
        if (!isValidCoordinate(checkpointLat, checkpointLng)) return false;
        if (!Double.isNaN(accuracy) && accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return false;
        if (!Double.isNaN(prevAccuracy) && prevAccuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return false;

        if (Math.abs(at - prevAt) > MAX_SEGMENT_GAP_MS) return false;

        double travelled = distanceMeters(prevLat, prevLng, lat, lng);
        if (Double.isNaN(travelled) || travelled > MAX_SEGMENT_GAP_METERS) return false;

        double distance = distanceToSegmentMeters(checkpointLat, checkpointLng, prevLat, prevLng, lat, lng);
        return distance <= GEOFENCE_RADIUS_METERS + margin(accuracy);
    }
}
