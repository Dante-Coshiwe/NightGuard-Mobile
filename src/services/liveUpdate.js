import { Capacitor } from '@capacitor/core';
import { getDeviceId, getCachedSiteSettings, getShiftSession } from '../lib/deviceStore';
import { getAdminDeviceBinding } from '../lib/deviceBinding';
import { getSiteBinding } from '../lib/siteResolver';

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
export const OTA_CURRENT_VERSION = '1.1.34';

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

// Resolve the org id for this device — it selects the OTA channel, so the
// device's own site binding is the right source, ahead of whoever last logged in.
async function resolveOrgId() {
  try {
    const siteBinding = await getSiteBinding();
    if (siteBinding?.organization_id) return siteBinding.organization_id;
  } catch { /* ignore */ }
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

  const shiftRunning = Boolean(getShiftSession());

  // Can this bundle be swapped in RIGHT NOW, inline, destroying the JS context where the
  // guard is standing? Only for a mandatory bundle, and only when nothing is going on.
  //
  // `deviceIsIdle()` is the fix for a real incident (2026-08-14): a guard adding a photo to
  // an incident report had the app reload under them and lost the report and the picture.
  // `check()` runs on every resume, and returning from the camera IS a resume — so the
  // moment a photo comes back was exactly when this fired. The 90-second idle rule already
  // existed and its comment already said "a reload while somebody is typing throws the form
  // away", but it lived on applyStagedUpdateIfSafe(), which never runs: that function
  // returns `deferred: shift_running` first, and under the device-session model the session
  // never clears. The careful gate was on the dead path; this, the live one, had none.
  //
  // `immediate` is the Settings override — an admin who pressed the button asked for it.
  const canApplyInline = immediate
    || (check.mandatory === true && !shiftRunning && deviceIsIdle() && !updatesHeld());

  // Already downloaded and staged on a previous check — don't re-download the same bundle
  // on every launch while it waits for a background/restart. A mandatory bundle re-checks
  // so it can apply as soon as possible, but only when it could actually apply: otherwise
  // it re-downloads the same megabytes every 30 minutes on a kiosk and never applies.
  const stagedAlready = localStorage.getItem(OTA_STAGED_KEY) === check.version;
  if (!immediate && stagedAlready && !canApplyInline) {
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

    // Decided above, before the download, so the staged-marker check and this agree.
    // NOTE: "nothing is lost" is true of the shift session, the offline queue and the
    // Supabase session — all of which live in storage that survives the swap — but it was
    // never true of anything held in React state, which is where a half-written incident
    // report and its freshly captured photos live. See lib/incidentDraft.js.
    const applyNow = canApplyInline;

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

// ---------------------------------------------------------------------------
//  Applying a staged bundle without anyone pressing a button
// ---------------------------------------------------------------------------
//
//  Staging alone was not a rollout. `next()` applies on the next app START, and a
//  gatehouse tablet is launched once and left running for weeks — so a published
//  bundle sat downloaded-but-dormant until somebody walked over and hit "Check for
//  updates now" in Settings. That button is now the manual override, not the
//  mechanism.
//
//  Two rules make auto-applying safe, and neither may be relaxed:
//
//   1. NEVER while a shift is running. set() destroys the JS context and reloads;
//      nothing is lost (the shift session, the offline queue and the Supabase
//      session all survive in storage) but a screen going blank mid-patrol reads
//      as a crash to the guard holding it.
//   2. Never mid-interaction. A reload while somebody is typing a visitor's name
//      throws the form away. So the device must have been untouched for
//      IDLE_BEFORE_APPLY_MS first — on resume that is implicit, the app was just
//      in the background.
//
//  Both gates open on their own on any real device: a kiosk between shifts is idle
//  by definition, and a phone that is pocketed is backgrounded.

const IDLE_BEFORE_APPLY_MS = 90 * 1000;
const AUTO_APPLY_POLL_MS = 60 * 1000;

let lastInteractionAt = Date.now();
let automationInstalled = false;

// Screens holding work that a reload would destroy. Idle time alone is not enough: a guard
// reading a form, or standing in the camera for two minutes, looks perfectly idle from in
// here. Note the resume handler calls touch() BEFORE check(), so coming back from the camera
// is never mistaken for idle either.
const updateHolds = new Set();

function deviceIsIdle() {
  return Date.now() - lastInteractionAt >= IDLE_BEFORE_APPLY_MS;
}

function updatesHeld() {
  return updateHolds.size > 0;
}

/**
 * Block context-destroying updates while something unsaved is on screen. Returns the release
 * function; call it when the work is finished or abandoned.
 *
 *   useEffect(() => holdLiveUpdates('incident-form'), []);
 */
export function holdLiveUpdates(reason = 'unsaved-work') {
  const token = `${reason}:${Math.random().toString(36).slice(2)}`;
  updateHolds.add(token);
  return () => { updateHolds.delete(token); };
}

// The bundle downloaded and waiting, or null. Cheap enough to poll.
async function getStagedBundle() {
  const { plugin: updater } = await loadUpdaterBox();
  if (!updater?.getNextBundle) return null;
  try {
    return await withTimeout(updater.getNextBundle(), 5000, 'updater.getNextBundle()');
  } catch {
    return null;
  }
}

// Apply the staged bundle if — and only if — it is safe to reload right now.
// Returns { status } describing what it decided, so callers can log the reason.
export async function applyStagedUpdateIfSafe({ requireIdle = true } = {}) {
  if (!Capacitor.isNativePlatform?.()) return { status: 'skipped' };

  // Rule 1. A guard on duty is never interrupted, however long the bundle waits.
  if (getShiftSession()) return { status: 'deferred', reason: 'shift_running' };

  // Rule 2.
  if (requireIdle && !deviceIsIdle()) {
    return { status: 'deferred', reason: 'in_use' };
  }

  // Rule 3. Something unsaved is on screen. This holds even on a resume (requireIdle:false):
  // the comment below used to reason that "coming back from the background is the cleanest
  // moment there is, nothing is half-typed" — which is wrong precisely when the thing that
  // backgrounded the app was the camera, opened from a half-filled incident report.
  if (updatesHeld()) return { status: 'deferred', reason: 'unsaved_work' };

  const staged = await getStagedBundle();
  if (!staged?.id) return { status: 'nothing_staged' };

  const { plugin: updater } = await loadUpdaterBox();
  if (!updater) return { status: 'skipped' };

  try {
    console.info('[LiveUpdate] applying staged bundle', staged.version || staged.id);
    // Terminal: destroys the JS context and reloads into the new bundle.
    await updater.set({ id: staged.id });
    return { status: 'applied', version: staged.version };
  } catch (err) {
    console.warn('[LiveUpdate] could not apply staged bundle:', err?.message || err);
    return { status: 'error', error: err?.message || String(err) };
  }
}

// Everything the app needs to keep itself current: check on launch, on resume and
// on a timer, and apply what has been downloaded as soon as the device is free.
// Call once from bootstrap.
export function installLiveUpdateAutomation({ periodicCheckMs = 30 * 60 * 1000 } = {}) {
  if (automationInstalled || !Capacitor.isNativePlatform?.()) return;
  automationInstalled = true;

  const touch = () => { lastInteractionAt = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((event) => {
    window.addEventListener(event, touch, { passive: true, capture: true });
  });

  const check = () => runOtaUpdate()
    .then((result) => {
      if (result?.status === 'staged') console.info('[LiveUpdate] update staged:', result.version);
    })
    .catch(() => { /* handled inside runOtaUpdate */ });

  check();

  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      // BEFORE check(): returning from the camera or the photo picker is a resume, and
      // without this the guard who just took a photo looks like an idle device to the
      // apply gate — which is exactly how a reload landed on a half-filled report.
      touch();
      check();
      // Coming back from the background is usually a clean moment — but not when what
      // backgrounded the app was the camera, so an active hold still wins (Rule 3).
      applyStagedUpdateIfSafe({ requireIdle: false }).catch(() => null);
    });
  }).catch(() => { /* @capacitor/app unavailable */ });

  // Kiosked devices can stay foregrounded for days and never fire a resume event, so
  // poll for both halves: is there anything new, and is it safe to install it yet.
  setInterval(check, periodicCheckMs);
  setInterval(() => {
    applyStagedUpdateIfSafe().catch(() => null);
  }, AUTO_APPLY_POLL_MS);
}
