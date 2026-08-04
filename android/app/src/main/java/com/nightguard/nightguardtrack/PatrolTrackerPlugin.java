package com.nightguard.nightguardtrack;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bridge to {@link PatrolTrackingService} — background patrol recording.
 *
 * Only this native shell has it. The web bundle is shared with older installs that have no such
 * plugin, so the JS side feature-detects (see src/lib/backgroundPatrol.js) and falls back to the
 * in-app GPS watch there. Nothing here may become required for a patrol to work.
 */
@CapacitorPlugin(name = "PatrolTracker")
public class PatrolTrackerPlugin extends Plugin {

    /** Present at all only on a shell that ships the service, which is the point of the check. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("running", PatrolTrackingService.isRunning());
        call.resolve(result);
    }

    /**
     * Begin recording. `checkpoints` is the site's GPS checkpoint list; the service matches against
     * it itself so a point captured with the screen off pings the guard immediately.
     */
    @PluginMethod
    public void start(PluginCall call) {
        // Refuse before the service is ever asked. Android 14+ throws SecurityException out of
        // startForeground() for a `location` service with no location grant, and that lands on the
        // main thread inside onStartCommand where it is fatal to the app rather than to the
        // patrol. The service guards itself too; this just keeps the failure on the JS side, which
        // already reads a rejection as "the in-app GPS watch is the recorder".
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            call.reject("location permission not granted");
            return;
        }

        JSArray checkpoints = call.getArray("checkpoints", new JSArray());
        String patrolId = call.getString("patrolId", null);

        Intent intent = new Intent(getContext(), PatrolTrackingService.class);
        intent.setAction(PatrolTrackingService.ACTION_START);
        intent.putExtra(PatrolTrackingService.EXTRA_PATROL_ID, patrolId);
        intent.putExtra(PatrolTrackingService.EXTRA_CHECKPOINTS,
            checkpoints == null ? "[]" : checkpoints.toString());

        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve(new JSObject().put("started", true));
        } catch (Exception e) {
            // Never fail the patrol because background recording could not start — the in-app
            // watch still runs. Report it so the JS side can tell the guard what it is getting.
            call.reject("start_failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), PatrolTrackingService.class);
        intent.setAction(PatrolTrackingService.ACTION_STOP);
        try {
            getContext().startService(intent);
        } catch (Exception e) {
            // A service that is already gone is the state we wanted anyway.
        }
        call.resolve(new JSObject().put("stopped", true));
    }

    /**
     * Take everything recorded since the last drain. The JS side persists these through the normal
     * offline queue, so this is the only handover point between native recording and syncing.
     */
    @PluginMethod
    public void drain(PluginCall call) {
        JSONObject drained = PatrolBuffer.drain(getContext());
        JSObject result = new JSObject();
        try {
            result.put("route", drained.optJSONArray("route") == null
                ? new JSONArray() : drained.optJSONArray("route"));
            result.put("captures", drained.optJSONArray("captures") == null
                ? new JSONArray() : drained.optJSONArray("captures"));
            result.put("active", drained.optBoolean("active", false));
            result.put("running", PatrolTrackingService.isRunning());
        } catch (Exception e) {
            call.reject("drain_failed: " + e.getMessage());
            return;
        }
        call.resolve(result);
    }

    /** Progress without consuming anything — for a status line while the app is open. */
    @PluginMethod
    public void status(PluginCall call) {
        JSONObject state = PatrolBuffer.read(getContext());
        JSObject result = new JSObject();
        result.put("running", PatrolTrackingService.isRunning());
        result.put("active", state.optBoolean("active", false));
        result.put("reachedCount", state.optJSONArray("reached") == null
            ? 0 : state.optJSONArray("reached").length());
        result.put("pendingCaptures", state.optJSONArray("captures") == null
            ? 0 : state.optJSONArray("captures").length());
        result.put("pendingRoutePoints", state.optJSONArray("route") == null
            ? 0 : state.optJSONArray("route").length());
        call.resolve(result);
    }
}
