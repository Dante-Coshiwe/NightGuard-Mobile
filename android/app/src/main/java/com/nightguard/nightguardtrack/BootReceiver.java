package com.nightguard.nightguardtrack;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.ActivityCompat;

/**
 * Brings continuous tracking back after a reboot.
 *
 * Without this, "always on" quietly means "until the phone restarts" — and a handset that has been
 * off overnight is exactly the one whose trail somebody will go looking for.
 *
 * Starting a `location` foreground service from here is only legal because the app holds
 * ACCESS_BACKGROUND_LOCATION: there is no visible activity at boot, so a while-in-use grant would
 * be refused. Both the permission and the enabled flag are re-checked rather than assumed — the
 * guard may have revoked the permission since the last boot, and asking for a service we cannot
 * legally start would throw inside startForeground and take the app with it.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "DeviceTrackerBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        if (!DeviceTrackerService.isConfigured(context)) {
            Log.i(TAG, "tracking not enabled on this device; nothing to restart");
            return;
        }

        boolean fine = ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;

        if (!fine || !background) {
            Log.w(TAG, "location permission no longer granted; not restarting tracking");
            return;
        }

        try {
            Intent start = new Intent(context, DeviceTrackerService.class);
            start.setAction(DeviceTrackerService.ACTION_START);
            context.startForegroundService(start);
            Log.i(TAG, "continuous tracking restarted after boot");
        } catch (Exception e) {
            // Some OEM builds refuse a foreground start this early. Not fatal: the next app launch
            // starts it anyway.
            Log.w(TAG, "could not restart tracking at boot: " + e.getMessage());
        }
    }
}
