import { Preferences } from '@capacitor/preferences';
import { supabase } from './supabase';
import { isAppOnline } from './connectivity';
import { getDeviceId, getCachedSiteSettings, purgeSiteScopedPatrolCaches } from './deviceStore';
import { getAdminDeviceBinding } from './deviceBinding';

// ============================================================================
//  Which site is this device at?
//
//  Historically the answer came from three unrelated places — the admin binding
//  written at first login, the cached site settings, and VITE_SITE_ID baked into
//  the bundle at build time. The build-time one is the reason a shared OTA
//  bundle could not exist: one zip cannot carry a different site id per site.
//  The binding one breaks the moment a manager holds more than one site, since
//  it copies their profile's home site onto every device they touch.
//
//  So there is now exactly one answer, resolved in this order:
//
//    1. the permanent local bind      — written once, when the manager picks
//    2. devices.site_id on the server — the authority; refreshed while online
//    3. the legacy admin binding      — devices already in the field
//    4. the cached site settings      — last known good, offline
//    5. VITE_SITE_ID                  — dev builds only, never in production
//
//  Everything is cached to Preferences (native, survives reinstall) with a
//  localStorage mirror for the synchronous call sites.
// ============================================================================

const BIND_KEY = 'nightguard_site_binding';

// Dev convenience only. A production bundle must not carry a site id: it ships
// to every device on the channel, so a baked value is a wrong answer waiting
// for a device whose binding has not resolved yet.
const DEV_SITE_ID = import.meta.env.DEV ? (import.meta.env.VITE_SITE_ID || '') : '';

let memo = null;

function readMirror() {
  try {
    const raw = localStorage.getItem(BIND_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMirror(binding) {
  try {
    localStorage.setItem(BIND_KEY, JSON.stringify(binding));
  } catch { /* quota / private mode — Preferences still holds it */ }
}

async function readPersisted() {
  try {
    const { value } = await Preferences.get({ key: BIND_KEY });
    if (value) return JSON.parse(value);
  } catch (err) {
    console.warn('[SiteResolver] Preferences read failed:', err?.message || err);
  }
  return readMirror();
}

async function writePersisted(binding) {
  const previousSiteId = (memo || readMirror())?.site_id || null;
  memo = binding;
  writeMirror(binding);

  // Moved to a different site: drop the old site's patrol setup and history so it can never be
  // shown here, nor re-uploaded into the new site's checkpoint table.
  if (previousSiteId && binding?.site_id && String(previousSiteId) !== String(binding.site_id)) {
    purgeSiteScopedPatrolCaches();
  }
  try {
    await Preferences.set({ key: BIND_KEY, value: JSON.stringify(binding) });
  } catch (err) {
    console.warn('[SiteResolver] Preferences write failed:', err?.message || err);
  }
  window.dispatchEvent(new Event('nightguard_site_binding_updated'));
  return binding;
}

/** The bound site id without awaiting anything. Null until the first resolve. */
export function getBoundSiteIdSync() {
  return memo?.site_id || readMirror()?.site_id || getCachedSiteSettings()?.id || DEV_SITE_ID || null;
}

/** The full binding record, or null if this device has never been bound. */
export async function getSiteBinding() {
  if (memo) return memo;
  memo = await readPersisted();
  return memo;
}

export async function isDeviceBound() {
  const binding = await getSiteBinding();
  return Boolean(binding?.site_id);
}

// Ask the server where this device belongs. Returns null when offline, when the
// RPC has not been deployed yet, or when the device has no row — all of which
// are "no answer", never "no site".
async function fetchServerSite(deviceId) {
  if (!deviceId) return null;
  // Offline is "no answer", not "no site" — and asking costs a 12s client
  // timeout we do not need to spend.
  if (!isAppOnline()) return null;
  try {
    const { data, error } = await supabase.rpc('device_site', { p_device_id: deviceId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.site_id ? row : null;
  } catch (err) {
    console.warn('[SiteResolver] device_site lookup failed:', err?.message || err);
    return null;
  }
}

// Background-only. Catches a device relocated on the dashboard, and retries a
// claim that was made while offline. Never throws, never blocks a caller, and
// never clears a binding — the worst case is that it changes nothing.
async function reconcileWithServer(existing, deviceId) {
  try {
    const server = await fetchServerSite(deviceId);

    if (server?.site_id && server.site_id !== existing.site_id) {
      await writePersisted({
        ...existing,
        site_id: server.site_id,
        site_name: server.site_name || existing.site_name,
        organization_id: server.organization_id || existing.organization_id,
        source: 'server',
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Bound locally but the server has no record — the claim was made offline,
    // or adopted from a legacy binding while the RPC was unreachable.
    if (!server && existing.source !== 'server') {
      await claimDeviceForSite(
        { id: existing.site_id, site_name: existing.site_name, organization_id: existing.organization_id },
        { silent: true },
      );
    }
  } catch { /* offline or not deployed yet — the local binding stands */ }
}

/**
 * Resolve this device's site and persist the answer.
 *
 * Non-destructive by design: it only ever fills a gap or confirms what is
 * already there. It never clears a binding, never touches the session, and
 * never signs anybody out — a device that cannot reach the server keeps
 * running on the site it already knows.
 */
export async function resolveSiteBinding({ refresh = false } = {}) {
  const existing = await getSiteBinding();
  const deviceId = getDeviceId();

  // 1. Already bound — the common case, and it returns without ever touching the
  //    network. Reconciling with the server (a relocation done on the dashboard,
  //    or a claim that never reached it) happens BEHIND the running app: boot
  //    must not wait on a link that may not answer.
  if (existing?.site_id) {
    if (refresh) void reconcileWithServer(existing, deviceId);
    return existing;
  }

  // 2. The server is the authority for a device that has a row but no local bind
  //    (reinstall, cleared storage, or a device provisioned from the dashboard).
  const server = await fetchServerSite(deviceId);
  if (server?.site_id) {
    return writePersisted({
      site_id: server.site_id,
      site_name: server.site_name || '',
      organization_id: server.organization_id || null,
      device_id: deviceId,
      bound_at: server.site_bound_at || new Date().toISOString(),
      source: 'server',
    });
  }

  // 3. Devices already in the field, bound under the old scheme. Adopting the
  //    value they are already running on is what keeps this update invisible to
  //    them — no picker, no re-login, no interruption.
  const legacy = await getAdminDeviceBinding();
  const cached = getCachedSiteSettings();
  const legacySiteId = legacy?.site_id || cached?.id || DEV_SITE_ID || null;

  if (legacySiteId) {
    const adopted = await writePersisted({
      site_id: legacySiteId,
      site_name: cached?.site_name || cached?.location_name || '',
      organization_id: legacy?.org_id || cached?.organization_id || null,
      device_id: deviceId,
      bound_at: new Date().toISOString(),
      source: 'legacy',
    });
    // Register it server-side so the dashboard stops guessing too. Best-effort:
    // it needs a session and a site the caller holds, and neither is required
    // for the device to keep working.
    claimDeviceForSite({ id: legacySiteId }, { silent: true }).catch(() => null);
    return adopted;
  }

  // 4. Nothing knows. The caller shows the picker rather than guessing — a shift
  //    filed against the wrong site is worse than one extra tap.
  return null;
}

/** The sites the signed-in manager may bind this device to — the dropdown. */
export async function listBindableSites() {
  const { data, error } = await supabase.rpc('my_sites');
  if (!error && Array.isArray(data)) return data;

  console.warn('[SiteResolver] my_sites unavailable, falling back:', error?.message || error);

  // Fallback for a project where the migration has not been applied yet: derive
  // the same answer client-side from the profile.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return [];

  const { data: profile } = await supabase
    .from('profiles')
    .select('site_id, organization_id, can_view_all_sites, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) return [];

  let query = supabase
    .from('sites')
    .select('id, site_name, organization_id, organizations(org_name)')
    .eq('is_active', true)
    .order('site_name');

  if (profile.is_super_admin) {
    // every site
  } else if (profile.can_view_all_sites && profile.organization_id) {
    query = query.eq('organization_id', profile.organization_id);
  } else if (profile.site_id) {
    query = query.eq('id', profile.site_id);
  } else {
    return [];
  }

  const { data: sites } = await query;
  return (sites || []).map((site) => ({
    id: site.id,
    site_name: site.site_name,
    organization_id: site.organization_id,
    org_name: site.organizations?.org_name || null,
  }));
}

/**
 * Bind this device to the chosen site — permanently. Writes the server record
 * first so the binding survives a wipe, then persists locally.
 */
export async function claimDeviceForSite(site, { silent = false } = {}) {
  const siteId = site?.id || site?.site_id;
  if (!siteId) throw new Error('No site selected');

  const deviceId = getDeviceId();
  if (!deviceId) throw new Error('Device id is not ready yet');

  let serverRow = null;
  try {
    const { data, error } = await supabase.rpc('claim_device', {
      p_device_id: deviceId,
      p_site_id: siteId,
      p_device_name: site.site_name ? `${site.site_name} device` : deviceId,
      p_model: navigator?.userAgent ? navigator.userAgent.slice(0, 120) : null,
      p_os_version: null,
      p_app_version: null,
    });
    if (error) throw error;
    serverRow = Array.isArray(data) ? data[0] : data;
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes('DEVICE_ALREADY_BOUND')) {
      throw new Error('This device is already bound to another site. Move it from the dashboard.');
    }
    if (message.includes('SITE_NOT_PERMITTED')) {
      throw new Error('You do not manage that site.');
    }
    // Offline, or the migration is not applied. The local bind still stands so
    // the device is usable; resolveSiteBinding retries the server later.
    if (!silent) console.warn('[SiteResolver] claim_device failed:', message);
    if (silent) throw err;
  }

  return writePersisted({
    site_id: siteId,
    site_name: site.site_name || serverRow?.device_name || '',
    organization_id: site.organization_id || null,
    device_id: deviceId,
    bound_at: serverRow?.site_bound_at || new Date().toISOString(),
    source: serverRow ? 'claimed' : 'claimed_offline',
  });
}

/**
 * Clearing a binding is deliberately not exported for normal use — a device
 * binds once. This exists for the dashboard-driven "unbind" path and for tests.
 */
export async function __clearSiteBinding() {
  memo = null;
  try {
    localStorage.removeItem(BIND_KEY);
    await Preferences.remove({ key: BIND_KEY });
  } catch { /* ignore */ }
}
