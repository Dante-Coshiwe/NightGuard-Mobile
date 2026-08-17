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

    private static File tmpFile(Context context) {
        return new File(context.getFilesDir(), FILE_NAME + ".tmp");
    }

    private static File bakFile(Context context) {
        return new File(context.getFilesDir(), FILE_NAME + ".bak");
    }

    /** Parse one candidate file, or null when it holds nothing usable. */
    private static JSONObject readOne(File f) {
        if (!f.exists() || f.length() == 0) return null;
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            byte[] bytes = new byte[(int) raf.length()];
            raf.readFully(bytes);
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (IOException | JSONException e) {
            android.util.Log.w("PatrolBuffer", "unreadable " + f.getName() + ": " + e.getMessage());
            return null;
        }
    }

    /**
     * Primary, then backup, then a staged write — the same recovery ladder atomicFile.js uses on
     * the JS side.
     *
     * This half of the system is the one most likely to be killed mid-write (a service recording
     * from a pocket for an hour) and it used to be the half with no recovery at all: a single
     * unparseable file discarded the entire walk. Falling back to the previous good copy turns
     * "lost the whole patrol" into "lost the last few points".
     *
     * Returning empty() when everything fails is still deliberate — a corrupt buffer must not
     * block every future write and leave the guard recording nothing for the rest of the shift.
     * See README.md, "Data capture and upload", risk 3.
     */
    static JSONObject read(Context context) {
        synchronized (LOCK) {
            JSONObject primary = readOne(file(context));
            if (primary != null) return primary;

            JSONObject backup = readOne(bakFile(context));
            if (backup != null) {
                android.util.Log.w("PatrolBuffer", "recovered patrol buffer from backup copy");
                return backup;
            }

            JSONObject staged = readOne(tmpFile(context));
            if (staged != null) {
                android.util.Log.w("PatrolBuffer", "recovered patrol buffer from staged write");
                return staged;
            }

            return empty();
        }
    }

    static void write(Context context, JSONObject state) {
        synchronized (LOCK) {
            File target = file(context);
            File tmp = tmpFile(context);
            File bak = bakFile(context);
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(state.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            } catch (IOException e) {
                android.util.Log.e("PatrolBuffer", "write failed: " + e.getMessage());
                return;
            }

            // Demote the current file to the backup before the new one takes its place, so there is
            // never a moment with no readable copy on disk.
            if (target.exists()) {
                //noinspection ResultOfMethodCallIgnored
                bak.delete();
                if (!target.renameTo(bak)) {
                    android.util.Log.w("PatrolBuffer", "could not demote current buffer to backup");
                }
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
     * Phase one of the two-phase handover: show the caller what is recorded WITHOUT consuming it.
     *
     * The single-step {@link #drain} below returns the walk and clears it in the same locked step,
     * so from the moment it returns until the JS side has persisted, the walk exists only in a JS
     * variable — a process kill there loses it outright, on the one path built specifically for a
     * phone in a pocket where a kill is expected rather than exceptional.
     *
     * Pairing this with {@link #acknowledge} makes the handover at-least-once instead: a kill
     * before the acknowledgement simply means the same points are handed over again next time, and
     * the JS side already de-duplicates captures against the session's reached list.
     * See README.md, "Data capture and upload", risk 2.
     */
    static JSONObject peek(Context context) {
        synchronized (LOCK) {
            JSONObject state = read(context);
            JSONObject out = new JSONObject();
            try {
                out.put("route", state.optJSONArray("route") == null
                    ? new JSONArray() : state.optJSONArray("route"));
                out.put("captures", state.optJSONArray("captures") == null
                    ? new JSONArray() : state.optJSONArray("captures"));
                out.put("active", state.optBoolean("active", false));
                out.put("patrolId", state.opt("patrolId") == null ? JSONObject.NULL : state.opt("patrolId"));
            } catch (JSONException e) {
                android.util.Log.e("PatrolBuffer", "peek failed: " + e.getMessage());
            }
            return out;
        }
    }

    /**
     * Phase two: drop exactly the leading items the caller confirmed it has persisted.
     *
     * Counts rather than a clear, because the recorder keeps appending while JS works. Both arrays
     * are append-only at the tail, so removing from the head removes precisely what was handed
     * over and leaves anything that arrived since.
     */
    static void acknowledge(Context context, int routeCount, int captureCount) {
        if (routeCount <= 0 && captureCount <= 0) return;
        synchronized (LOCK) {
            JSONObject state = read(context);
            try {
                state.put("route", dropLeading(state.optJSONArray("route"), routeCount));
                state.put("captures", dropLeading(state.optJSONArray("captures"), captureCount));
                write(context, state);
            } catch (JSONException e) {
                android.util.Log.e("PatrolBuffer", "acknowledge failed: " + e.getMessage());
            }
        }
    }

    private static JSONArray dropLeading(JSONArray source, int count) throws JSONException {
        JSONArray kept = new JSONArray();
        if (source == null) return kept;
        for (int i = Math.max(0, count); i < source.length(); i++) kept.put(source.get(i));
        return kept;
    }

    /**
     * Hand the recorded route and captures to the caller and clear them, in one locked step so a
     * fix arriving mid-drain cannot be silently dropped between the read and the write.
     *
     * ⚠ At-most-once: see {@link #peek}. Kept because a web bundle newer than this shell is not
     * the only combination in the field — an OLDER bundle running on this APK still calls it.
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

    /**
     * Append a route point, thinning the trail when it hits the cap.
     *
     * This used to delete the oldest half outright, so a patrol left running long enough lost the
     * beginning of its walk entirely and silently — the guard's first hour simply was not on the
     * map. Halving the resolution of the older portion instead keeps the whole route's SHAPE, at
     * lower detail, which is what a patrol trail is actually evidence of. The most recent points
     * are kept at full resolution because they are the ones still being written against.
     *
     * This matches what appendRoutePoint() does on the JS side (src/lib/patrolSession.js), so a
     * walk recorded with the screen off thins the same way as one recorded with it on.
     * See README.md, "Data capture and upload", risk 8.
     */
    static void appendRoutePoint(JSONObject state, JSONObject point) throws JSONException {
        JSONArray route = state.optJSONArray("route");
        if (route == null) route = new JSONArray();
        if (route.length() >= MAX_ROUTE_POINTS) {
            final int tailSize = 500;
            int head = Math.max(0, route.length() - tailSize);
            JSONArray thinned = new JSONArray();
            for (int i = 0; i < head; i += 2) thinned.put(route.get(i));
            for (int i = head; i < route.length(); i++) thinned.put(route.get(i));
            route = thinned;
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
