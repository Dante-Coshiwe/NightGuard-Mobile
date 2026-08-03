package com.nightguard.nightguardtrack;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Records the patrol while the app is backgrounded or the screen is off.
 *
 * Why this exists: Android all but stops the WebView's JS timers and GPS watch once the display
 * sleeps, so a patrol walked with the phone in a pocket used to record no route and miss every
 * checkpoint — the app could only ask the guard to keep the screen on. A foreground service with
 * the `location` type is the one thing Android keeps feeding location to.
 *
 * It does the full job natively so the ping is live: it holds the checkpoint list, matches each fix
 * with exactly the rules in {@link PatrolGeo} (same as src/lib/geo.js), notifies the guard the
 * moment a point is captured, and writes everything to {@link PatrolBuffer}. The JS side drains
 * that buffer when the app is next alive and hands the scans to the offline queue, so the network
 * and de-duplication logic stays in one place instead of being reimplemented in Java.
 *
 * Started only while the app is in the foreground (the guard taps Start Patrol), which is what lets
 * it keep location access with plain while-in-use permission — no ACCESS_BACKGROUND_LOCATION grant
 * and no trip to system Settings.
 */
public class PatrolTrackingService extends Service implements LocationListener {
    private static final String TAG = "PatrolTracking";
    public static final String ACTION_START = "com.nightguard.nightguardtrack.PATROL_START";
    public static final String ACTION_STOP = "com.nightguard.nightguardtrack.PATROL_STOP";
    public static final String EXTRA_PATROL_ID = "patrolId";
    public static final String EXTRA_CHECKPOINTS = "checkpoints";

    public static final String POINTS_CHANNEL_ID = "patrol_points";
    private static final int ONGOING_NOTIFICATION_ID = 1002;
    private static final int POINT_NOTIFICATION_BASE_ID = 2000;

    /** Route thinning, matching patrolSession.js so both trails look the same. */
    private static final double MIN_POINT_DISTANCE_METERS = 6;
    private static final long MIN_POINT_INTERVAL_MS = 20000;

    private static final long UPDATE_INTERVAL_MS = 4000;

    private LocationManager locationManager;
    private JSONObject state;
    private Location previousFix;
    private int pointNotificationOffset = 0;
    private boolean tracking = false;

    /** Lets the JS side ask whether tracking is genuinely running rather than assuming. */
    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createPointsChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            stopTracking();
            stopSelf();
            return START_NOT_STICKY;
        }

        // Reload from disk first so a service restarted by Android after a process kill resumes the
        // patrol it was already recording instead of starting a blank one.
        state = PatrolBuffer.read(this);

        if (intent != null && intent.hasExtra(EXTRA_CHECKPOINTS)) {
            applyStartPayload(intent);
        }

        if (!state.optBoolean("active", false)) {
            Log.w(TAG, "no active patrol in buffer; stopping");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundNotification();
        startTracking();
        return START_REDELIVER_INTENT;
    }

    private void applyStartPayload(Intent intent) {
        try {
            String checkpointsJson = intent.getStringExtra(EXTRA_CHECKPOINTS);
            String patrolId = intent.getStringExtra(EXTRA_PATROL_ID);
            JSONArray checkpoints = new JSONArray(checkpointsJson == null ? "[]" : checkpointsJson);

            String previousPatrolId = state.optString("patrolId", "");
            boolean samePatrol = patrolId != null && patrolId.equals(previousPatrolId);

            state.put("active", true);
            state.put("patrolId", patrolId == null ? JSONObject.NULL : patrolId);
            state.put("checkpoints", checkpoints);
            if (!samePatrol) {
                // A different patrol: previous progress must not carry over, but anything the JS
                // side has not drained yet stays put so it is never lost.
                state.put("reached", new JSONArray());
            }
            PatrolBuffer.write(this, state);
        } catch (JSONException e) {
            Log.e(TAG, "bad start payload: " + e.getMessage());
        }
    }

    private void startTracking() {
        if (tracking) return;
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "ACCESS_FINE_LOCATION not granted; cannot track");
            stopSelf();
            return;
        }

        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER, UPDATE_INTERVAL_MS, 0f, this, Looper.getMainLooper());
            // A second provider keeps the trail alive where GPS is weak (indoors, under cover).
            // Duplicate fixes are harmless: thinning and the geofence handle them.
            String secondary = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? LocationManager.FUSED_PROVIDER
                : LocationManager.NETWORK_PROVIDER;
            if (locationManager.isProviderEnabled(secondary)) {
                locationManager.requestLocationUpdates(
                    secondary, UPDATE_INTERVAL_MS, 0f, this, Looper.getMainLooper());
            }
            tracking = true;
            running = true;
            JSONArray configured = state.optJSONArray("checkpoints");
            Log.i(TAG, "tracking started with " + (configured == null ? 0 : configured.length())
                + " checkpoint(s), patrol=" + state.optString("patrolId", "?"));
        } catch (SecurityException | IllegalArgumentException e) {
            Log.e(TAG, "requestLocationUpdates failed: " + e.getMessage());
            stopSelf();
        }
    }

    private void stopTracking() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
                // Permission revoked while running; nothing left to remove.
            }
        }
        tracking = false;
        running = false;

        // Mark the patrol inactive but KEEP route/captures: the JS side has not necessarily drained
        // them yet, and throwing them away here would lose the walk this service exists to protect.
        if (state != null) {
            try {
                state.put("active", false);
                PatrolBuffer.write(this, state);
            } catch (JSONException ignored) {
                // Fixed key.
            }
        }
        Log.i(TAG, "tracking stopped");
    }

    @Override
    public void onLocationChanged(Location location) {
        if (state == null || location == null) return;

        double lat = location.getLatitude();
        double lng = location.getLongitude();
        if (!PatrolGeo.isValidCoordinate(lat, lng)) return;

        double accuracy = location.hasAccuracy() ? location.getAccuracy() : Double.NaN;
        long at = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();

        try {
            appendThinnedRoutePoint(lat, lng, accuracy, at);
            captureCheckpoints(lat, lng, accuracy, at);
            PatrolBuffer.write(this, state);
        } catch (JSONException e) {
            Log.e(TAG, "fix handling failed: " + e.getMessage());
        }

        previousFix = location;
    }

    private void appendThinnedRoutePoint(double lat, double lng, double accuracy, long at)
        throws JSONException {
        JSONArray route = state.optJSONArray("route");
        if (route != null && route.length() > 0) {
            JSONObject last = route.optJSONObject(route.length() - 1);
            if (last != null) {
                double moved = PatrolGeo.distanceMeters(
                    last.optDouble("latitude"), last.optDouble("longitude"), lat, lng);
                long elapsed = at - last.optLong("at");
                if (moved < MIN_POINT_DISTANCE_METERS && elapsed < MIN_POINT_INTERVAL_MS) return;
            }
        }

        JSONObject point = new JSONObject();
        point.put("latitude", lat);
        point.put("longitude", lng);
        point.put("accuracy", Double.isNaN(accuracy) ? JSONObject.NULL : Math.round(accuracy));
        point.put("at", at);
        PatrolBuffer.appendRoutePoint(state, point);
    }

    private void captureCheckpoints(double lat, double lng, double accuracy, long at)
        throws JSONException {
        JSONArray checkpoints = state.optJSONArray("checkpoints");
        if (checkpoints == null) return;

        for (int i = 0; i < checkpoints.length(); i++) {
            JSONObject checkpoint = checkpoints.optJSONObject(i);
            if (checkpoint == null) continue;

            String id = checkpoint.optString("id", "");
            if (id.isEmpty() || PatrolBuffer.isReached(state, id)) continue;

            double cpLat = checkpoint.optDouble("latitude", Double.NaN);
            double cpLng = checkpoint.optDouble("longitude", Double.NaN);
            if (!PatrolGeo.isValidCoordinate(cpLat, cpLng)) continue;

            double distance = PatrolGeo.distanceMeters(cpLat, cpLng, lat, lng);
            boolean reached = PatrolGeo.isWithinGeofence(distance, accuracy);

            if (!reached && previousFix != null) {
                reached = PatrolGeo.segmentCrossedCheckpoint(
                    cpLat, cpLng,
                    previousFix.getLatitude(), previousFix.getLongitude(),
                    previousFix.hasAccuracy() ? previousFix.getAccuracy() : Double.NaN,
                    previousFix.getTime() > 0 ? previousFix.getTime() : at,
                    lat, lng, accuracy, at);
            }

            if (!reached) continue;

            PatrolBuffer.markReached(state, id);

            JSONObject capture = new JSONObject();
            capture.put("checkpointId", id);
            capture.put("checkpointName", checkpoint.optString("name", "Checkpoint"));
            capture.put("zone", checkpoint.opt("zone") == null ? JSONObject.NULL : checkpoint.optString("zone"));
            capture.put("tagUid", checkpoint.opt("tagUid") == null ? JSONObject.NULL : checkpoint.optString("tagUid"));
            capture.put("latitude", lat);
            capture.put("longitude", lng);
            capture.put("accuracy", Double.isNaN(accuracy) ? JSONObject.NULL : Math.round(accuracy));
            capture.put("at", at);
            PatrolBuffer.appendCapture(state, capture);

            Log.i(TAG, "captured '" + checkpoint.optString("name", "?") + "' id=" + id
                + " distance=" + Math.round(distance) + "m acc=" + Math.round(accuracy));
            notifyPointCaptured(checkpoint.optString("name", "Checkpoint"));
            updateOngoingNotification();
        }
    }

    // ---------------------------------------------------------------------
    //  Notifications
    // ---------------------------------------------------------------------

    private void createPointsChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            POINTS_CHANNEL_ID, "Patrol Points", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Confirms each patrol point as it is captured");
        channel.enableVibration(true);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private PendingIntent openAppIntent() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildOngoingNotification() {
        int reached = state != null && state.optJSONArray("reached") != null
            ? state.optJSONArray("reached").length() : 0;
        int total = state != null && state.optJSONArray("checkpoints") != null
            ? state.optJSONArray("checkpoints").length() : 0;

        return new NotificationCompat.Builder(this, MainActivity.GUARD_SERVICE_CHANNEL_ID)
            .setContentTitle("Patrol in progress")
            .setContentText(total > 0
                ? String.format("Recording your route — %d/%d points captured", reached, total)
                : "Recording your route")
            .setSmallIcon(getApplicationInfo().icon)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(openAppIntent())
            .build();
    }

    private void startForegroundNotification() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            : 0;
        ServiceCompat.startForeground(this, ONGOING_NOTIFICATION_ID, buildOngoingNotification(), type);
    }

    private void updateOngoingNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(ONGOING_NOTIFICATION_ID, buildOngoingNotification());
    }

    private void notifyPointCaptured(String checkpointName) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Notification notification = new NotificationCompat.Builder(this, POINTS_CHANNEL_ID)
            .setContentTitle("Patrol point gathered")
            .setContentText(checkpointName + " patrol point has been gathered")
            .setSmallIcon(getApplicationInfo().icon)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build();
        NotificationManagerCompat.from(this)
            .notify(POINT_NOTIFICATION_BASE_ID + (pointNotificationOffset++), notification);
    }

    // ---------------------------------------------------------------------

    @Override
    public void onDestroy() {
        stopTracking();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // Required on older API levels; no behaviour needed.
    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}
}
