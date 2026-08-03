package com.nightguard.nightguardtrack;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KioskPlugin")
public class KioskPlugin extends Plugin {

    /** Returns "locked" (device-owner lock task), "pinned" (screen pinning), or "none". */
    private String currentLockState() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return "none";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int state = am.getLockTaskModeState();
            if (state == ActivityManager.LOCK_TASK_MODE_LOCKED) return "locked";
            if (state == ActivityManager.LOCK_TASK_MODE_PINNED) return "pinned";
            return "none";
        }
        // Pre-M devices can't report the state; assume pinned if the API is even available.
        return "pinned";
    }

    @PluginMethod
    public void startKioskMode(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startKioskMode();
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    getActivity().startLockTask();
                }
            } catch (Exception e) {
                // startLockTask throws IllegalStateException if the activity is not resumed.
            }
            JSObject result = new JSObject();
            String state = currentLockState();
            result.put("lockState", state);
            result.put("locked", !"none".equals(state));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void stopKioskMode(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).stopKioskMode();
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    getActivity().stopLockTask();
                }
            } catch (Exception e) {
                // Ignore — a device that is not pinned throws when un-pinning.
            }
            JSObject result = new JSObject();
            result.put("lockState", currentLockState());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void getLockState(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            String state = currentLockState();
            result.put("lockState", state);
            result.put("locked", !"none".equals(state));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void startForegroundService(PluginCall call) {
        Intent intent = new Intent(getContext(), GuardForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopForegroundService(PluginCall call) {
        Intent intent = new Intent(getContext(), GuardForegroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
