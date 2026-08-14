package com.nightguard.nightguardtrack;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * The patrol state the background service owns, held on disk so nothing is lost when Android kills
 * the process mid-walk (which it will, on a phone in a pocket for an hour).
 *
 * The WebView is NOT the owner of this data while the service runs — the JS side drains it when the
 * app is next alive and hands the scans to the offline queue. Everything here is therefore written
 * atomically (temp file + rename + fsync) so a kill during a write cannot leave a half-written
 * patrol that fails to parse and takes the whole walk with it.
 */
final class PatrolBuffer {
    private static final String FILE_NAME = "patrol_background.json";
    private static final Object LOCK = new Object();
    /** Cap the trail so a forgotten patrol cannot grow the file without bound. */
    private static final int MAX_ROUTE_POINTS = 5000;
    private static final int MAX_CAPTURES = 500;

    private PatrolBuffer() {}

    private static File file(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    static JSONObject read(Context context) {
        synchronized (LOCK) {
            File f = file(context);
            if (!f.exists()) return empty();
            try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                byte[] bytes = new byte[(int) raf.length()];
                raf.readFully(bytes);
                return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            } catch (IOException | JSONException e) {
                // ⚠ CRUCIAL: this discards the entire recorded walk.
                //
                // Returning empty() is deliberate — a corrupt buffer would otherwise block every
                // future write and the guard would record nothing at all for the rest of the shift.
                // But note the asymmetry with the JS side: atomicFile.js keeps a .bak AND a staged
                // .tmp and recovers from either, while this has neither, even though the background
                // service is the half most likely to be killed mid-write. A backup copy here would
                // turn "lost the whole patrol" into "lost the last few points".
                // See README.md, "Data capture and upload", risk 3.
                android.util.Log.w("PatrolBuffer", "unreadable buffer, starting fresh: " + e.getMessage());
                return empty();
            }
        }
    }

    static void write(Context context, JSONObject state) {
        synchronized (LOCK) {
            File target = file(context);
            File tmp = new File(context.getFilesDir(), FILE_NAME + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(state.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            } catch (IOException e) {
                android.util.Log.e("PatrolBuffer", "write failed: " + e.getMessage());
                return;
            }
            if (!tmp.renameTo(target)) {
                // renameTo can fail if the target exists on some filesystems; replace explicitly.
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                if (!tmp.renameTo(target)) {
                    android.util.Log.e("PatrolBuffer", "atomic rename failed; buffer not updated");
                }
            }
        }
    }

    /**
     * Hand the recorded route and captures to the caller and clear them, in one locked step so a
     * fix arriving mid-drain cannot be silently dropped between the read and the write.
     *
     * `reached` is deliberately NOT cleared: it is what stops an already-credited checkpoint being
     * captured a second time when the guard walks back past it.
     */
    static JSONObject drain(Context context) {
        synchronized (LOCK) {
            JSONObject state = read(context);
            JSONObject drained = new JSONObject();
            try {
                drained.put("route", state.optJSONArray("route") == null
                    ? new JSONArray() : state.optJSONArray("route"));
                drained.put("captures", state.optJSONArray("captures") == null
                    ? new JSONArray() : state.optJSONArray("captures"));
                drained.put("active", state.optBoolean("active", false));
                drained.put("patrolId", state.opt("patrolId") == null ? JSONObject.NULL : state.opt("patrolId"));

                state.put("route", new JSONArray());
                state.put("captures", new JSONArray());
                write(context, state);
            } catch (JSONException e) {
                android.util.Log.e("PatrolBuffer", "drain failed: " + e.getMessage());
            }
            return drained;
        }
    }

    static JSONObject empty() {
        JSONObject state = new JSONObject();
        try {
            state.put("active", false);
            state.put("patrolId", JSONObject.NULL);
            state.put("checkpoints", new JSONArray());
            state.put("reached", new JSONArray());
            state.put("route", new JSONArray());
            state.put("captures", new JSONArray());
        } catch (JSONException ignored) {
            // Fixed literal keys; cannot throw.
        }
        return state;
    }

    /** Append a route point, trimming the oldest half if the trail hits the cap. */
    static void appendRoutePoint(JSONObject state, JSONObject point) throws JSONException {
        JSONArray route = state.optJSONArray("route");
        if (route == null) route = new JSONArray();
        if (route.length() >= MAX_ROUTE_POINTS) {
            JSONArray trimmed = new JSONArray();
            for (int i = route.length() / 2; i < route.length(); i++) trimmed.put(route.get(i));
            route = trimmed;
        }
        route.put(point);
        state.put("route", route);
    }

    static void appendCapture(JSONObject state, JSONObject capture) throws JSONException {
        JSONArray captures = state.optJSONArray("captures");
        if (captures == null) captures = new JSONArray();
        // Never drop the newest capture: if we are somehow at the cap, drop the oldest instead.
        if (captures.length() >= MAX_CAPTURES) captures.remove(0);
        captures.put(capture);
        state.put("captures", captures);
    }

    static boolean isReached(JSONObject state, String checkpointId) {
        JSONArray reached = state.optJSONArray("reached");
        if (reached == null) return false;
        for (int i = 0; i < reached.length(); i++) {
            if (checkpointId.equals(reached.optString(i))) return true;
        }
        return false;
    }

    static void markReached(JSONObject state, String checkpointId) throws JSONException {
        if (isReached(state, checkpointId)) return;
        JSONArray reached = state.optJSONArray("reached");
        if (reached == null) reached = new JSONArray();
        reached.put(checkpointId);
        state.put("reached", reached);
    }
}
