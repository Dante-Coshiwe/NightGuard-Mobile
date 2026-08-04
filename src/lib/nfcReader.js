import { Capacitor, registerPlugin } from '@capacitor/core';

// Automatic NFC tag reading — the native half lives in NfcReaderPlugin.java.
//
// The old path used the Web NFC API (`NDEFReader`), which Chrome for Android implements but a
// WebView does not. Inside the APK the feature-detect was permanently false, so no tag ever read
// and the guard was left tapping a button that could not work. Reading is native now; this module
// is the thin, failure-tolerant bridge.
//
// As with background patrol, the same bundle runs on shells with no such plugin, so every call is
// feature-detected. Nothing in the patrol flow may depend on NFC succeeding — most sites are
// GPS-only and never see a tag.

const NfcReader = registerPlugin('NfcReader');

export function isNfcReaderAvailable() {
  try {
    if (!Capacitor.isNativePlatform?.()) return false;
    return Capacitor.isPluginAvailable?.('NfcReader') === true;
  } catch {
    return false;
  }
}

/**
 * Tag UIDs arrive from different places in different shapes — native gives bare lower-case hex,
 * Web NFC gave colon-separated, and a tag_uid typed into the admin panel can carry dashes, spaces
 * or upper case. Compare them stripped of all of that, or a checkpoint whose tag is genuinely
 * being held against the phone reads as "unregistered".
 */
export function normaliseTagUid(value) {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether the device has NFC hardware and it is switched on right now. */
export async function nfcStatus() {
  if (!isNfcReaderAvailable()) return { available: false, enabled: false };
  try {
    return await NfcReader.isAvailable();
  } catch {
    return { available: false, enabled: false };
  }
}

/**
 * Start automatic detection and call `onTag(uid)` for every tag presented. Returns a cleanup
 * function; calling it stops detection and removes the listener.
 *
 * Resolves to a no-op cleanup when NFC is unavailable, so callers need no branching.
 */
export async function listenForNfcTags(onTag) {
  if (!isNfcReaderAvailable() || typeof onTag !== 'function') return () => {};

  let handle;
  try {
    handle = await NfcReader.addListener('nfcTag', (event) => {
      const uid = event?.tagUid;
      if (uid) onTag(String(uid));
    });
    await NfcReader.startListening();
  } catch (err) {
    console.warn('[NfcReader] could not start tag detection:', err?.message || err);
    handle?.remove?.();
    return () => {};
  }

  return () => {
    try {
      NfcReader.stopListening();
    } catch {
      // Already stopped, or the activity is gone — either way detection is off.
    }
    handle?.remove?.();
  };
}
