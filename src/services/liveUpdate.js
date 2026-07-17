import { Capacitor } from '@capacitor/core';
import { getDeviceId, getCachedSiteSettings } from '../lib/deviceStore';
import { getAdminDeviceBinding } from '../lib/deviceBinding';

// ============================================================================
//  Self-hosted OTA live updates on Supabase.
//
//  We run @capgo/capacitor-updater in MANUAL mode (autoUpdate is OFF in
//  capacitor.config.json). The Capgo cloud is never contacted. Instead:
//
//    1. checkForUpdate()  -> POST to the `ota-check` Edge Function, which
//       returns { updateAvailable, version, url (signed), checksum, ... }.
//    2. If available, download the zip with the plugin, stage it with next()
//       (applies on the next app background/restart — no mid-session reload),
//       and report progress to the `ota-report` Edge Function.
//    3. notifyLiveUpdateReady() runs on every launch to confirm the freshly
//       booted bundle is healthy; without it the plugin auto-rolls-back.
//
//  Everything is a no-op on the web build so the browser dev experience is
//  unchanged.
// ============================================================================

// Web bundle version currently shipped. Bump this on every release you publish
// (it must match the `version` you pass to `ota:publish`). It is what the
// server compares against to decide if a newer bundle exists.
export const OTA_CURRENT_VERSION = '1.0.15';

const OTA_CHECK_FN = 'ota-check';
const OTA_REPORT_FN = 'ota-report';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Reject if a promise takes longer than ms. Used around every await in the OTA
// path so the flow ALWAYS terminates — a hung native bridge call or fetch must
// surface as an error, never as an infinite "Checking…".
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// Call an Edge Function with plain fetch + anon key and a hard timeout.
// Deliberately NOT supabase.functions.invoke: that routes through supabase-js's
// auth-aware fetch, which awaits the session behind gotrue's navigator.locks —
// a token refresh suspended by the WebView holds that lock forever, and every
// OTA call then hangs with no error. OTA is plumbing; it must never depend on
// auth/session state.
async function invokeFn(name, body, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let updaterBoxPromise = null;

// Returns { plugin } — the plugin proxy BOXED in a plain object.
//
// NEVER resolve a promise with the plugin proxy itself: Capacitor proxies answer
// every property — including `then` — by invoking a native plugin method, so
// promise assimilation calls CapacitorUpdater.then(), Android throws
// '"CapacitorUpdater.then()" is not implemented', and the wrapping promise never
// settles. Every await of it then hangs forever (the endless "Checking…" bug).
async function loadUpdaterBox() {
  if (!Capacitor.isNativePlatform?.()) return { plugin: null };
  if (!updaterBoxPromise) {
    updaterBoxPromise = import('@capgo/capacitor-updater')
      .then((mod) => ({ plugin: mod.CapacitorUpdater || null }))
      .catch((err) => {
        console.warn('[LiveUpdate] plugin unavailable:', err?.message || err);
        return { plugin: null };
      });
  }
  return updaterBoxPromise;
}

// Resolve the org id for this device from whatever the app has stored.
async function resolveOrgId() {
  try {
    const binding = await getAdminDeviceBinding();
    if (binding?.org_id) return binding.org_id;
  } catch { /* ignore */ }
  const site = getCachedSiteSettings();
  return site?.organization_id || site?.org_id || site?.organizations?.id || null;
}

// The installed native shell version (APK versionName), used by the server to
// avoid pushing a web bundle that needs a newer native shell.
async function resolveNativeVersion() {
  try {
    const { App } = await import('@capacitor/app');
    const info = await withTimeout(App.getInfo(), 5000, 'App.getInfo()');
    return info?.version || null;
  } catch {
    return null;
  }
}

// Fire-and-forget report to the ota-report Edge Function. Never throws.
async function reportOta(body) {
  try {
    await invokeFn(OTA_REPORT_FN, body, 10000);
  } catch (err) {
    console.warn('[LiveUpdate] report failed:', err?.message || err);
  }
}

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

// Mark the current bundle as good. Must run as early as possible on every
// launch, otherwise the plugin assumes the update crashed and rolls back.
export async function notifyLiveUpdateReady() {
  const { plugin: updater } = await loadUpdaterBox();
  if (!updater) return;
  try {
    await updater.notifyAppReady();
    console.info('[LiveUpdate] notifyAppReady sent');
    // If the staged bundle is now the one running, clear the staged marker so
    // future checks resume normal download behaviour.
    const staged = localStorage.getItem('nightguard_ota_staged_version');
    if (staged && (await getRunningVersion()) === staged) {
      localStorage.removeItem('nightguard_ota_staged_version');
    }
  } catch (err) {
    console.warn('[LiveUpdate] notifyAppReady failed:', err?.message || err);
  }
}

// Info about the bundle currently running — useful for a Settings "app version"
// line. Returns { version, id } or null on the built-in bundle / web.
export async function getLiveUpdateBundle() {
  const { plugin: updater } = await loadUpdaterBox();
  if (!updater) return null;
  try {
    // Timeboxed: a wedged native bridge must not stall the whole check flow.
    const res = await withTimeout(updater.current(), 5000, 'updater.current()');
    return res?.bundle || null;
  } catch {
    return null;
  }
}

// The version string to show in the UI: the live bundle's version if one is
// active, otherwise the built-in OTA_CURRENT_VERSION.
export async function getRunningVersion() {
  const bundle = await getLiveUpdateBundle();
  // The builtin bundle reports id 'builtin' and version = the NATIVE versionName
  // (e.g. "1.4"), not a web bundle version — using it would make the server
  // mis-compare versions. Only trust the version of a real downloaded bundle.
  return bundle && bundle.id !== 'builtin' && bundle.version && bundle.version !== 'builtin'
    ? bundle.version
    : OTA_CURRENT_VERSION;
}

// Ask the server whether a newer bundle exists. Returns the parsed check
// response, or null on web / error. Does not download anything.
export async function checkForUpdate() {
  if (!Capacitor.isNativePlatform?.()) return null;

  const deviceId = getDeviceId();
  const orgId = await resolveOrgId();
  const nativeVersion = await resolveNativeVersion();
  const currentVersion = await getRunningVersion();
  const platform = Capacitor.getPlatform?.() || 'android';

  try {
    const data = await invokeFn(OTA_CHECK_FN, { deviceId, orgId, currentVersion, nativeVersion, platform });
    return data || null;
  } catch (err) {
    console.warn('[LiveUpdate] check failed:', err?.message || err);
    // Surface the failure server-side; a check that dies silently on the client
    // is invisible in ota_update_logs and rollouts look "stuck" for no reason.
    reportOta({
      deviceId, orgId, nativeVersion, platform,
      fromVersion: currentVersion, toVersion: null,
      status: 'failed', errorMessage: `check: ${err?.message || err}`,
    });
    return null;
  }
}

// Full flow: check -> download -> stage. By default the update is staged with
// next() and applies on the next background/restart (seamless — no interruption
// mid-shift). Pass { immediate: true } to apply and reload right away, or the
// server can force it via `mandatory`.
//
// Returns one of:
//   { status: 'up_to_date' }
//   { status: 'staged', version }     (will apply on next background/restart)
//   { status: 'applied', version }    (reloaded now — code after this won't run)
//   { status: 'error', error }
//   { status: 'skipped' }             (web / plugin unavailable)
const OTA_STAGED_KEY = 'nightguard_ota_staged_version';
let otaRunPromise = null;

// Single-flight wrapper: the launch check, the resume listener, the periodic
// timer, and the Settings button can all fire close together — only one update
// run may be active at a time or the same bundle gets downloaded repeatedly.
export function runOtaUpdate(options = {}) {
  if (!otaRunPromise) {
    otaRunPromise = doRunOtaUpdate(options).finally(() => { otaRunPromise = null; });
  }
  return otaRunPromise;
}

async function doRunOtaUpdate({ immediate = false } = {}) {
  const { plugin: updater } = await loadUpdaterBox();
  if (!updater) {
    // On native this means the updater plugin is missing from the installed shell —
    // OTA can never work until a new APK is sideloaded. Still hit the server so the
    // device is visible in ota_update_logs instead of failing silently (that
    // invisibility is exactly how the pre-OTA builds went unnoticed).
    if (Capacitor.isNativePlatform?.()) {
      checkForUpdate().catch(() => { /* best-effort visibility ping */ });
    }
    return { status: 'skipped' };
  }

  const check = await checkForUpdate();
  if (!check || !check.updateAvailable) {
    return { status: 'up_to_date' };
  }

  // Already downloaded and staged on a previous check — don't re-download the
  // same bundle on every launch while it waits for a background/restart to apply.
  // (immediate skips this: the user asked to apply NOW, staging isn't enough.)
  if (!immediate && check.mandatory !== true && localStorage.getItem(OTA_STAGED_KEY) === check.version) {
    return { status: 'staged', version: check.version };
  }

  const deviceId = getDeviceId();
  const orgId = await resolveOrgId();
  const nativeVersion = await resolveNativeVersion();
  const platform = Capacitor.getPlatform?.() || 'android';
  const fromVersion = await getRunningVersion();
  const toVersion = check.version;
  const base = { deviceId, orgId, fromVersion, toVersion, nativeVersion, platform };

  try {
    await reportOta({ ...base, status: 'download_started' });

    // Download the zip. We do NOT pass the plugin's `checksum`/`sessionKey`
    // (those are for Capgo-encrypted bundles); our zips are plain, and the
    // signed URL + short TTL is our transport integrity. `version` labels the
    // downloaded bundle so current()/list() report it correctly.
    const bundle = await withTimeout(
      updater.download({ url: check.url, version: toVersion }),
      180000,
      'bundle download',
    );

    // bundleId here is the server's ota_bundles.id (for our audit log), which
    // the Edge Function does not round-trip; we log by version instead.
    await reportOta({ ...base, status: 'downloaded' });

    const applyNow = immediate || check.mandatory === true;

    if (applyNow) {
      await reportOta({ ...base, status: 'applied' });
      // Terminal: destroys the JS context and reloads into the new bundle.
      await updater.set({ id: bundle.id });
      return { status: 'applied', version: toVersion };
    }

    // Stage for next background/restart — the user is not interrupted.
    await updater.next({ id: bundle.id });
    localStorage.setItem(OTA_STAGED_KEY, toVersion);
    // We report 'applied' from notifyAppReady on the next boot instead; here we
    // just record that it is staged.
    return { status: 'staged', version: toVersion };
  } catch (err) {
    const message = err?.message || String(err);
    console.warn('[LiveUpdate] update failed:', message);
    await reportOta({ ...base, status: 'failed', errorMessage: message });
    return { status: 'error', error: message };
  }
}
