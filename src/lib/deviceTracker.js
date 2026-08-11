import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { getCachedSiteSettings, getDeviceId } from './deviceStore';

// Continuous device location — the native half lives in DeviceTrackerService.java.
//
// Unlike patrol recording, this is not tied to a shift or a patrol: it runs for the life of the
// device and restarts after a reboot, which is what "where has this handset been" requires.
//
// The service uploads on its own, so it needs its own credentials. They are handed over here at
// start and persisted natively, because after a reboot there is no WebView alive to ask.
//
// IMPORTANT: the same web bundle also runs on shells with no such plugin. Every call is
// feature-detected and failure-tolerant — nothing in the app may depend on this succeeding.

const DeviceTracker = registerPlugin('DeviceTracker');

export function isDeviceTrackerAvailable() {
  try {
    if (!Capacitor.isNativePlatform?.()) return false;
    return Capacitor.isPluginAvailable?.('DeviceTracker') === true;
  } catch {
    return false;
  }
}

export async function deviceTrackerStatus() {
  if (!isDeviceTrackerAvailable()) {
    return { available: false, running: false, enabled: false, backgroundGranted: false };
  }
  try {
    return await DeviceTracker.isAvailable();
  } catch {
    return { available: false, running: false, enabled: false, backgroundGranted: false };
  }
}

/** Opens this app's system settings page, where "Allow all the time" actually lives. */
export async function openLocationSettings() {
  if (!isDeviceTrackerAvailable()) return false;
  try {
    await DeviceTracker.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start (or resume) continuous tracking.
 *
 * Returns { started, backgroundGranted }. `started` true with `backgroundGranted` false is the
 * common first-run state and is NOT a failure: tracking works, but only while the app is alive and
 * it will not survive a reboot until someone grants "Allow all the time" in system Settings.
 * Android 11+ refuses to offer that in a dialog, so it cannot be requested from here — the caller
 * has to send the admin to openLocationSettings().
 */
export async function startDeviceTracking() {
  if (!isDeviceTrackerAvailable()) return { started: false, backgroundGranted: false };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const deviceId = getDeviceId();
  if (!supabaseUrl || !anonKey || !deviceId) {
    return { started: false, backgroundGranted: false };
  }

  // Fine location must be held before the service is asked to start: Android 14+ validates the
  // `location` service type inside startForeground() and throws, which kills the whole app.
  try {
    const status = await Geolocation.checkPermissions();
    if (status.location !== 'granted') {
      const requested = await Geolocation.requestPermissions();
      if (requested.location !== 'granted') {
        return { started: false, backgroundGranted: false };
      }
    }
  } catch {
    return { started: false, backgroundGranted: false };
  }

  try {
    return await DeviceTracker.start({
      supabaseUrl,
      anonKey,
      deviceId,
      siteId: getCachedSiteSettings()?.id || null,
    });
  } catch (err) {
    console.warn('[DeviceTracker] start failed:', err?.message || err);
    return { started: false, backgroundGranted: false };
  }
}

export async function stopDeviceTracking() {
  if (!isDeviceTrackerAvailable()) return;
  try {
    await DeviceTracker.stop();
  } catch (err) {
    console.warn('[DeviceTracker] stop failed:', err?.message || err);
  }
}
