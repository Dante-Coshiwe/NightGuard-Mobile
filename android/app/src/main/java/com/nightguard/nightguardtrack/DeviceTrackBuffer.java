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
 * Unsent location pings, held on disk.
 *
 * Same reasoning as {@link PatrolBuffer}: a phone in a pocket for hours will have its process
 * killed, and a device out of signal has nowhere to send. Every write is temp file + rename +
 * fsync so a kill mid-write cannot leave a half-written file that fails to parse and takes the
 * whole trail with it.
 *
 * Capped hard. This buffer fills on its own with no user action, so an unbounded one on a handset
 * that is offline for a week would grow until the storage did.
 */
final class DeviceTrackBuffer {
    private static final String FILE_NAME = "device_track.json";
    private static final Object LOCK = new Object();
    /** ~28 hours at one ping a minute. Beyond that the oldest half goes. */
    private static final int MAX_POINTS = 1700;

    private DeviceTrackBuffer() {}

    private static File file(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    static JSONArray read(Context context) {
        synchronized (LOCK) {
            File f = file(context);
            if (!f.exists()) return new JSONArray();
            try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                byte[] bytes = new byte[(int) raf.length()];
                raf.readFully(bytes);
                return new JSONArray(new String(bytes, StandardCharsets.UTF_8));
            } catch (IOException | JSONException e) {
                android.util.Log.w("DeviceTrackBuffer", "unreadable buffer, starting fresh: " + e.getMessage());
                return new JSONArray();
            }
        }
    }

    private static void write(Context context, JSONArray points) {
        synchronized (LOCK) {
            File target = file(context);
            File tmp = new File(context.getFilesDir(), FILE_NAME + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(points.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            } catch (IOException e) {
                android.util.Log.e("DeviceTrackBuffer", "write failed: " + e.getMessage());
                return;
            }
            if (!tmp.renameTo(target)) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                if (!tmp.renameTo(target)) {
                    android.util.Log.e("DeviceTrackBuffer", "atomic rename failed; buffer not updated");
                }
            }
        }
    }

    static int append(Context context, JSONObject point) {
        synchronized (LOCK) {
            JSONArray points = read(context);
            if (points.length() >= MAX_POINTS) {
                JSONArray trimmed = new JSONArray();
                for (int i = points.length() / 2; i < points.length(); i++) {
                    trimmed.put(points.opt(i));
                }
                points = trimmed;
            }
            points.put(point);
            write(context, points);
            return points.length();
        }
    }

    /**
     * Remove the first {@code count} points — the ones just accepted by the server.
     *
     * Only ever called after a confirmed 2xx. Anything that arrived during the upload is at the
     * tail and is deliberately kept, which is why this drops a prefix rather than clearing.
     */
    static void dropFirst(Context context, int count) {
        synchronized (LOCK) {
            JSONArray points = read(context);
            JSONArray remaining = new JSONArray();
            for (int i = count; i < points.length(); i++) remaining.put(points.opt(i));
            write(context, remaining);
        }
    }
}
