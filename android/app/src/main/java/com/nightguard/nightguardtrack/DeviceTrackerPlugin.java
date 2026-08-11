package com.nightguard.nightguardtrack;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge to {@link DeviceTrackerService} — continuous device location.
 *
 * As with PatrolTracker, the same web bundle runs on older shells that have no such plugin, so
 * every call from JS is feature-detected. Nothing here may become required for the app to work.
 *
 * The service uploads on its own and therefore needs its own credentials: the Supabase URL and
 * anon key are handed over from JS at start and persisted, so a restart at boot — with no WebView
 * alive to ask — still has everything it needs.
 */
@CapacitorPlugin(name = "DeviceTracker")
public class DeviceTrackerPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("running", DeviceTrackerService.isRunning());
        result.put("enabled", DeviceTrackerService.isConfigured(getContext()));
        result.put("backgroundGranted", hasBackgroundLocation());
        call.resolve(result);
    }

    private boolean hasFineLocation() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * "Allow all the time". Below Android 10 there is no such separate grant — fine location is
     * already background location — so treat it as held rather than reporting a permission the
     * platform will never return.
     */
    private boolean hasBackgroundLocation() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasFineLocation();
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Open this app's settings page.
     *
     * From Android 11 "Allow all the time" CANNOT be granted from a permission dialog at all — the
     * system only offers it in Settings, and a requestPermissions() call for it is silently denied.
     * So the honest flow is to send the admin there rather than to keep asking.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("supabaseUrl");
        String anonKey = call.getString("anonKey");
        String deviceId = call.getString("deviceId");
        String siteId = call.getString("siteId");

        if (url == null || anonKey == null || deviceId == null) {
            call.reject("supabaseUrl, anonKey and deviceId are all required");
            return;
        }
        // Refuse before the service is ever asked. Android 14+ throws SecurityException out of
        // startForeground() for a location service with no permission, and that kills the app.
        if (!hasFineLocation()) {
            call.reject("Location permission is not granted");
            return;
        }

        SharedPreferences.Editor edit = DeviceTrackerService.prefs(getContext()).edit();
        edit.putBoolean(DeviceTrackerService.KEY_ENABLED, true);
        edit.putString(DeviceTrackerService.KEY_URL, url.replaceAll("/+$", ""));
        edit.putString(DeviceTrackerService.KEY_ANON, anonKey);
        edit.putString(DeviceTrackerService.KEY_DEVICE_ID, deviceId);
        edit.putString(DeviceTrackerService.KEY_SITE_ID, siteId);
        edit.apply();

        Intent intent = new Intent(getContext(), DeviceTrackerService.class);
        intent.setAction(DeviceTrackerService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), intent);

        JSObject result = new JSObject();
        result.put("started", true);
        // Without the background grant this still works, but only while the app is alive and it
        // will not come back after a reboot. The caller needs to know which it got.
        result.put("backgroundGranted", hasBackgroundLocation());
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), DeviceTrackerService.class);
        intent.setAction(DeviceTrackerService.ACTION_STOP);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }
}
