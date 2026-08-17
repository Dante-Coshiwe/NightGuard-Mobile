import { Preferences } from '@capacitor/preferences';
import { hashPin } from '../services/notificationService';

export const ADMIN_BINDING_KEYS = {
  email: 'admin_email',
  id: 'admin_id',
  orgId: 'org_id',
  siteId: 'site_id',
};

const BINDING_JSON_KEY = 'nightguard_admin_binding';

function setLocalFallback(binding) {
  localStorage.setItem(BINDING_JSON_KEY, JSON.stringify(binding));
  if (binding.admin_email) localStorage.setItem('nightguard_bound_email', binding.admin_email);
}

function getLocalFallback() {
  try {
    const raw = localStorage.getItem(BINDING_JSON_KEY);
    if (raw) return JSON.parse(raw);
    const legacyEmail = localStorage.getItem('nightguard_bound_email');
    return legacyEmail ? { admin_email: legacyEmail } : null;
  } catch {
    return null;
  }
}

// This value is the site on the ADMIN'S PROFILE — their home site — and it is NOT this device's
// site. For a manager who holds several sites they are simply different things, and conflating
// them is how a handset ends up permanently filed against a site nobody chose:
// resolveSiteBinding()'s legacy path adopts `site_id` off this record, and login() writes this
// record three lines before calling it. Marking the provenance lets the resolver tell a binding
// written here apart from one left by a pre-1.1.0 bundle, which genuinely does record the site
// the device was operating as. Absence of the marker means "old bundle" — do not invert this.
export const ADMIN_PROFILE_SITE_SOURCE = 'admin_profile';

export async function saveAdminDeviceBinding(userData = {}, email = '') {
  const binding = {
    admin_email: String(userData.email || email || '').trim().toLowerCase(),
    admin_id: userData.id || '',
    org_id: userData.organization_id || userData.org_id || '',
    site_id: userData.site_id || '',
    site_id_source: ADMIN_PROFILE_SITE_SOURCE,
    saved_at: new Date().toISOString(),
  };

  try {
    const adminPin = userData.admin_pin || userData.pin || userData.adminPin;
    const adminPinHash = adminPin
      ? JSON.stringify({ algorithm: 'sha256', value: await hashPin(adminPin), createdAt: new Date().toISOString() })
      : null;
    await Promise.all([
      Preferences.set({ key: ADMIN_BINDING_KEYS.email, value: binding.admin_email }),
      Preferences.set({ key: ADMIN_BINDING_KEYS.id, value: binding.admin_id }),
      Preferences.set({ key: ADMIN_BINDING_KEYS.orgId, value: binding.org_id }),
      Preferences.set({ key: ADMIN_BINDING_KEYS.siteId, value: binding.site_id }),
      Preferences.set({ key: BINDING_JSON_KEY, value: JSON.stringify(binding) }),
      ...(adminPinHash ? [Preferences.set({ key: 'admin_pin_hash', value: adminPinHash })] : []),
    ]);
    if (adminPinHash) localStorage.setItem('admin_pin_hash', adminPinHash);
  } catch (err) {
    console.warn('[DeviceBinding] Preferences save failed:', err?.message || err);
  }

  setLocalFallback(binding);
  return binding;
}

export async function getAdminDeviceBinding() {
  try {
    const [{ value: raw }, { value: email }, { value: id }, { value: orgId }, { value: siteId }] = await Promise.all([
      Preferences.get({ key: BINDING_JSON_KEY }),
      Preferences.get({ key: ADMIN_BINDING_KEYS.email }),
      Preferences.get({ key: ADMIN_BINDING_KEYS.id }),
      Preferences.get({ key: ADMIN_BINDING_KEYS.orgId }),
      Preferences.get({ key: ADMIN_BINDING_KEYS.siteId }),
    ]);

    if (raw) return JSON.parse(raw);
    if (email) {
      return {
        admin_email: email,
        admin_id: id || '',
        org_id: orgId || '',
        site_id: siteId || '',
      };
    }
  } catch (err) {
    console.warn('[DeviceBinding] Preferences read failed:', err?.message || err);
  }

  return getLocalFallback();
}

export async function clearAdminDeviceBinding() {
  try {
    await Promise.all([
      Preferences.remove({ key: ADMIN_BINDING_KEYS.email }),
      Preferences.remove({ key: ADMIN_BINDING_KEYS.id }),
      Preferences.remove({ key: ADMIN_BINDING_KEYS.orgId }),
      Preferences.remove({ key: ADMIN_BINDING_KEYS.siteId }),
      Preferences.remove({ key: BINDING_JSON_KEY }),
      Preferences.remove({ key: 'admin_pin_hash' }),
    ]);
  } catch (err) {
    console.warn('[DeviceBinding] Preferences clear failed:', err?.message || err);
  }

  localStorage.removeItem(BINDING_JSON_KEY);
  localStorage.removeItem('nightguard_bound_email');
  localStorage.removeItem('admin_pin_hash');
}
