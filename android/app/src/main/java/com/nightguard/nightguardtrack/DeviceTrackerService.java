package com.nightguard.nightguardtrack;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Continuous device location trail — the "where has this handset been" recorder.
 *
 * Deliberately SEPARATE from {@link PatrolTrackingService}. That one is patrol-scoped, runs at a
 * 4 second cadence because a ~10 m geofence needs it, and its output is patrol evidence. This one
 * runs for the life of the device at a fraction of the power, and its output is a background
 * trail. Merging them would have meant either burning patrol-grade battery all day or recording
 * patrols too coarsely to score.
 *
 * Unlike the patrol service this is START_STICKY and restarts at boot: the whole point is that it
 * outlives the app. That is only permitted because ACCESS_BACKGROUND_LOCATION is held — a
 * while-in-use grant cannot start a location foreground service with no visible activity, which is
 * exactly the situation after a reboot.
 *
 * It uploads itself rather than handing points to the WebView. With the screen off the WebView is
 * frozen, so anything that waits for JS is not a background tracker at all.
 */
public class DeviceTrackerService extends Service implements LocationListener {
    private static final String TAG = "DeviceTracker";

    public static final String ACTION_START = "com.nightguard.nightguardtrack.TRACK_START";
    public static final String ACTION_STOP = "com.nightguard.nightguardtrack.TRACK_STOP";

    static final String PREFS = "nightguard_device_tracker";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_URL = "supabaseUrl";
    static final String KEY_ANON = "anonKey";
    static final String KEY_DEVICE_ID = "deviceId";
    static final String KEY_SITE_ID = "siteId";

    private static final String CHANNEL_ID = "device_tracking";
    private static final int NOTIFICATION_ID = 1003;

    /**
     * A background trail, not a patrol recording. One fix a minute and 25 m of movement is enough
     * to answer "where was this phone" without turning the GPS into a battery heater.
     */
    private static final long UPDATE_INTERVAL_MS = 60000;
    private static final float UPDATE_DISPLACEMENT_M = 25f;

    /** Upload when either of these trips, so a moving device is current and an idle one is cheap. */
    private static final int UPLOAD_BATCH_SIZE = 10;
    private static final long UPLOAD_INTERVAL_MS = 5 * 60 * 1000;

    private LocationManager locationManager;
    private ExecutorService uploader;
    private final AtomicBoolean uploadInFlight = new AtomicBoolean(false);
    private long lastUploadAttemptAt = 0;
    private boolean tracking = false;

    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Everything needed to upload is configured from JS and persisted, so a boot start has it. */
    static boolean isConfigured(Context context) {
        SharedPreferences p = prefs(context);
        return p.getBoolean(KEY_ENABLED, false)
            && p.getString(KEY_URL, null) != null
            && p.getString(KEY_ANON, null) != null
            && p.getString(KEY_DEVICE_ID, null) != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        uploader = Executors.newSingleThreadExecutor();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            prefs(this).edit().putBoolean(KEY_ENABLED, false).apply();
            stopTracking();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!isConfigured(this)) {
            Log.w(TAG, "not configured; nothing to do");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Same rule as PatrolTrackingService and for the same reason: Android 14+ validates the
        // location service type inside startForeground() and throws SecurityException when the
        // permission is missing, which kills the whole app. Check first, and treat a refusal as a
        // normal outcome rather than a crash.
        if (!hasLocationPermission()) {
            Log.w(TAG, "location permission not held; not starting");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!startForegroundNotification()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startTracking();
        // START_STICKY, unlike the patrol service: this one is meant to outlive everything and be
        // brought back by the system. There is no intent to redeliver — all state is in prefs.
        return START_STICKY;
    }

    private boolean hasLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Location reporting", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows while this device is reporting its location to the control room.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private boolean startForegroundNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        // Says plainly what it is. A permanent location notification that a guard cannot explain
        // is worse than no notification: it invites them to go looking for a way to kill it.
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NightGuard location reporting")
            .setContentText("This device reports its location to the control room.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pending)
            .build();

        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                    : 0);
            return true;
        } catch (Exception e) {
            // Refused because the app is not in an eligible state. Normal after a process kill;
            // never fatal. The boot receiver and the next app launch will try again.
            Log.w(TAG, "startForeground refused: " + e.getMessage());
            return false;
        }
    }

    private void startTracking() {
        if (tracking) return;
        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER, UPDATE_INTERVAL_MS, UPDATE_DISPLACEMENT_M,
                this, Looper.getMainLooper());
            // Indoors — which is most of a night shift — GPS gives nothing at all. The coarse
            // provider is what keeps the trail alive there.
            String secondary = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? LocationManager.FUSED_PROVIDER
                : LocationManager.NETWORK_PROVIDER;
            if (locationManager.isProviderEnabled(secondary)) {
                locationManager.requestLocationUpdates(
                    secondary, UPDATE_INTERVAL_MS, UPDATE_DISPLACEMENT_M, this, Looper.getMainLooper());
            }
            tracking = true;
            running = true;
            registerReceiver(connectivityReceiver,
                new IntentFilter("android.net.conn.CONNECTIVITY_CHANGE"));
            Log.i(TAG, "continuous tracking started");
        } catch (SecurityException | IllegalArgumentException e) {
            Log.e(TAG, "requestLocationUpdates failed: " + e.getMessage());
            stopSelf();
        }
    }

    private void stopTracking() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) { }
        }
        if (tracking) {
            try {
                unregisterReceiver(connectivityReceiver);
            } catch (IllegalArgumentException ignored) { }
        }
        tracking = false;
        running = false;
        Log.i(TAG, "continuous tracking stopped");
    }

    /** Signal coming back is the moment a buffered trail can finally go out. */
    private final BroadcastReceiver connectivityReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            maybeUpload(true);
        }
    };

    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !PatrolGeo.isValidCoordinate(location.getLatitude(), location.getLongitude())) {
            return;
        }

        try {
            JSONObject point = new JSONObject();
            point.put("device_id", prefs(this).getString(KEY_DEVICE_ID, null));
            String siteId = prefs(this).getString(KEY_SITE_ID, null);
            point.put("site_id", siteId == null ? JSONObject.NULL : siteId);
            point.put("recorded_at", isoTime(location.getTime() > 0 ? location.getTime() : System.currentTimeMillis()));
            point.put("latitude", location.getLatitude());
            point.put("longitude", location.getLongitude());
            point.put("accuracy", location.hasAccuracy() ? Math.round(location.getAccuracy()) : JSONObject.NULL);
            int battery = batteryPercent();
            point.put("battery_level", battery < 0 ? JSONObject.NULL : battery);
            // Patrol-time points are already recorded as evidence by the patrol service; marking
            // these lets the dashboard tell a background trail from a walked patrol.
            point.put("source", PatrolTrackingService.isRunning() ? "patrol" : "background");

            int pending = DeviceTrackBuffer.append(this, point);
            maybeUpload(pending >= UPLOAD_BATCH_SIZE);
        } catch (JSONException e) {
            Log.e(TAG, "could not record fix: " + e.getMessage());
        }
    }

    private static String isoTime(long millis) {
        java.text.SimpleDateFormat fmt =
            new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US);
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date(millis));
    }

    private int batteryPercent() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (bm == null) return -1;
            int level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return (level >= 0 && level <= 100) ? level : -1;
        } catch (Exception e) {
            return -1;
        }
    }

    private void maybeUpload(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastUploadAttemptAt < UPLOAD_INTERVAL_MS) return;
        if (!uploadInFlight.compareAndSet(false, true)) return;
        lastUploadAttemptAt = now;
        uploader.execute(this::uploadPending);
    }

    private void uploadPending() {
        try {
            JSONArray pending = DeviceTrackBuffer.read(this);
            if (pending.length() == 0) return;

            SharedPreferences p = prefs(this);
            String base = p.getString(KEY_URL, null);
            String anon = p.getString(KEY_ANON, null);
            if (base == null || anon == null) return;

            // Send only what we have RIGHT NOW and drop exactly that many on success. Fixes that
            // land mid-upload sit at the tail and go with the next batch, so nothing is dropped
            // unsent.
            int sending = pending.length();
            HttpURLConnection conn = (HttpURLConnection) new URL(base + "/rest/v1/device_locations").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", anon);
            conn.setRequestProperty("Authorization", "Bearer " + anon);
            conn.setRequestProperty("Prefer", "return=minimal");

            try (OutputStream out = conn.getOutputStream()) {
                out.write(pending.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
            }

            int status = conn.getResponseCode();
            conn.disconnect();

            if (status >= 200 && status < 300) {
                DeviceTrackBuffer.dropFirst(this, sending);
                Log.i(TAG, "uploaded " + sending + " point(s)");
            } else if (status == 400 || status == 401 || status == 403 || status == 404) {
                // The server refused the payload itself — a missing table, a policy that forbids
                // the insert, a bad key. Retrying identical data forever would just burn battery,
                // and the buffer cap stops it growing without bound, so leave it and say so
                // loudly enough to be found in logcat.
                Log.e(TAG, "upload rejected (HTTP " + status + "); check the device_locations table and its policies");
            } else {
                Log.w(TAG, "upload failed (HTTP " + status + "); keeping points for the next attempt");
            }
        } catch (Exception e) {
            // Offline, DNS, timeout. Entirely expected on a guard's phone; keep the points.
            Log.i(TAG, "upload deferred: " + e.getMessage());
        } finally {
            uploadInFlight.set(false);
        }
    }

    @Override
    public void onDestroy() {
        stopTracking();
        if (uploader != null) uploader.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // Required by LocationListener on older API levels.
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }
    @Override public void onStatusChanged(String provider, int status, android.os.Bundle extras) { }
}
