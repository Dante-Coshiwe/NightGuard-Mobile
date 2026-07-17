import { Preferences } from '@capacitor/preferences';
import { hashPin } from './notificationService';

export const ADMIN_PIN_HASH_KEY = 'admin_pin_hash';

export async function getAdminPinHashRecord() {
  const { value } = await Preferences.get({ key: ADMIN_PIN_HASH_KEY }).catch(() => ({ value: null }));
  const raw = value || localStorage.getItem(ADMIN_PIN_HASH_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed?.value ? parsed : { algorithm: 'sha256', value: raw, createdAt: null };
  } catch {
    return { algorithm: 'sha256', value: raw, createdAt: null };
  }
}

export async function hasAdminPinHash() {
  const record = await getAdminPinHashRecord();
  return Boolean(record?.value);
}

export async function saveAdminPin(pin) {
  const hashedPin = await hashPin(pin);
  const record = {
    algorithm: 'sha256',
    value: hashedPin,
    createdAt: new Date().toISOString(),
  };
  const value = JSON.stringify(record);
  localStorage.setItem(ADMIN_PIN_HASH_KEY, value);
  await Preferences.set({ key: ADMIN_PIN_HASH_KEY, value });
  return record;
}

export async function getStoredAdminPinHashValue() {
  const record = await getAdminPinHashRecord();
  if (record?.value) return record.value;

  const { value: legacyPin } = await Preferences.get({ key: 'admin_pin' }).catch(() => ({ value: null }));
  const fallbackPin = legacyPin || localStorage.getItem('admin_pin');
  return fallbackPin ? hashPin(fallbackPin) : null;
}
