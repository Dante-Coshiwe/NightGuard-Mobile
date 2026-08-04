package com.nightguard.nightguardtrack;

import android.app.Activity;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Automatic NFC tag detection.
 *
 * Why this exists: the app used to read tags through the Web NFC API (`NDEFReader` in
 * src/hooks/useNFC.js). That API ships in Chrome for Android but is NOT exposed to a WebView, so
 * inside this APK the feature-detect was always false and NFC could never fire — the "Scan NFC"
 * button only ever worked in a desktop/Chrome test. Tag reading has to be native.
 *
 * Reader mode rather than intent filters: the guard taps a tag while the app is already open, and
 * reader mode delivers that without bouncing through a new Intent (which would restart the
 * activity mid-patrol). FLAG_READER_SKIP_NDEF_CHECK means a blank or Mifare tag with no NDEF
 * payload still reports — all that is wanted is the UID, which is what checkpoints are keyed on.
 *
 * Limitation worth knowing: Android only dispatches NFC to a foreground activity. With the screen
 * off or the app backgrounded, no tag is read — GPS remains the recorder for a pocketed phone.
 */
@CapacitorPlugin(name = "NfcReader")
public class NfcReaderPlugin extends Plugin {
    private static final String TAG = "NfcReader";
    private static final String TAG_EVENT = "nfcTag";

    private NfcAdapter adapter;
    /** Whether JS asked for tags; drives re-arming across resume without a second call. */
    private boolean listening = false;

    @Override
    public void load() {
        try {
            adapter = NfcAdapter.getDefaultAdapter(getContext());
        } catch (Exception e) {
            adapter = null;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", adapter != null);
        result.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(result);
    }

    /** Begin delivering `nfcTag` events. Safe to call repeatedly. */
    @PluginMethod
    public void startListening(PluginCall call) {
        if (adapter == null) {
            call.reject("nfc_unavailable");
            return;
        }
        listening = true;
        arm();
        call.resolve(new JSObject().put("listening", true));
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        listening = false;
        disarm();
        call.resolve();
    }

    private void arm() {
        Activity activity = getActivity();
        if (adapter == null || activity == null || !listening) return;
        // Every common tag family, and skip the NDEF read: the UID is the whole payload we want.
        int flags = NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V
            | NfcAdapter.FLAG_READER_NFC_BARCODE
            | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;
        activity.runOnUiThread(() -> {
            try {
                adapter.enableReaderMode(activity, this::onTagDiscovered, flags, null);
            } catch (Exception e) {
                Log.e(TAG, "enableReaderMode failed: " + e);
            }
        });
    }

    private void disarm() {
        Activity activity = getActivity();
        if (adapter == null || activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                adapter.disableReaderMode(activity);
            } catch (Exception e) {
                Log.e(TAG, "disableReaderMode failed: " + e);
            }
        });
    }

    private void onTagDiscovered(Tag tag) {
        if (tag == null) return;
        String uid = toHex(tag.getId());
        if (uid.isEmpty()) return;
        Log.i(TAG, "tag read uid=" + uid);
        JSObject data = new JSObject();
        data.put("tagUid", uid);
        notifyListeners(TAG_EVENT, data);
    }

    /** Lower-case, separator-free hex — normalised again on the JS side before matching. */
    private static String toHex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    // Reader mode is bound to the activity, so the platform drops it when the app pauses. Re-arm on
    // the way back or the first tag after a screen-off would be silently missed.
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (listening) arm();
    }

    @Override
    protected void handleOnPause() {
        disarm();
        super.handleOnPause();
    }
}
