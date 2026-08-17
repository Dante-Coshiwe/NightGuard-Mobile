import { Capacitor } from '@capacitor/core';
import { readJsonFileWithRecovery, writeJsonFileAtomic } from './atomicFile';
import { buildPendingPhoto, dataUrlToBlob } from './photoCapture';

// ============================================================================
//  An unfinished GATE ENTRY must survive the app going away.
//
//  This is README risk 1, and it is the worst of the eight because of where it
//  sits in the guard's hands:
//
//    * A photo is REQUIRED to submit a vehicle or a pedestrian (validateForm in
//      both tabs), so EVERY gate entry passes through a camera intent. That
//      intent starts an external activity and backgrounds this app, and a
//      low-RAM handset routinely gets reclaimed there.
//    * The typed fields sit ABOVE the photo button, so by the time the guard
//      reaches the dangerous moment they have already typed everything. The
//      maximum amount of work is at risk at the moment of maximum danger.
//    * It fails silently. The guard comes back to an empty form, assumes they
//      mis-tapped, and the vehicle that drove through the gate is in no record
//      at all.
//
//  This is the same mechanism IncidentScreen already has (lib/incidentDraft.js)
//  and the storage rule is identical and non-negotiable:
//
//  WHERE THIS IS STORED MATTERS. A photo is base64 megabytes; the offline queue
//  lives in localStorage and `saveQueue()` handles a quota exception with
//  nothing but a console.error, silently discarding the entire outbox. Putting
//  draft photos in the same quota risks costing a guard every queued write to
//  save one unsent form. So on native the draft goes to the filesystem — never
//  localStorage. On web there is no camera round-trip to survive, so the draft
//  keeps TEXT ONLY, for the same quota reason.
//
//  One file per kind: a guard registering a vehicle and a pedestrian in the
//  same minute must not have one draft overwrite the other.
// ============================================================================

const DRAFT_FILES = {
  vehicle: 'nightguard-vehicle-entry-draft.json',
  pedestrian: 'nightguard-pedestrian-entry-draft.json',
};

const WEB_DRAFT_KEYS = {
  vehicle: 'nightguard_vehicle_entry_draft',
  pedestrian: 'nightguard_pedestrian_entry_draft',
};

// Long enough that typing does not rewrite a megabyte of base64 on every keystroke, short
// enough to be well inside any pause. Backgrounding flushes immediately regardless — see
// installEntryDraftFlush, which is the case this whole file exists for.
const SAVE_DEBOUNCE_MS = 800;

// Per-kind timers, so the two tabs cannot cancel each other's pending write.
const saveTimers = new Map();
const pendingWrites = new Map();

function isNative() {
  return Boolean(Capacitor?.isNativePlatform?.());
}

function draftFile(kind) {
  return DRAFT_FILES[kind] || DRAFT_FILES.vehicle;
}

function webKey(kind) {
  return WEB_DRAFT_KEYS[kind] || WEB_DRAFT_KEYS.vehicle;
}

// uploadEntryPhoto() filters on `photo?.blob`, so a restored photo without one is silently
// dropped on submit and the picture is lost with no error — the exact class of bug this file
// exists to prevent. Rebuild the Blob from the stored data URL.
function rehydratePhoto(photo) {
  if (!photo?.dataUrl) return null;
  try {
    return { ...photo, blob: dataUrlToBlob(photo.dataUrl) };
  } catch {
    return null;
  }
}

function serialiseDraft(kind, { fields, photo }) {
  const keepPhotos = isNative();
  return {
    kind,
    savedAt: new Date().toISOString(),
    fields: { ...(fields || {}) },
    photo: keepPhotos ? buildPendingPhoto(photo) : null,
    // So a restored draft can say honestly that the picture did not come back.
    photoDropped: !keepPhotos && Boolean(photo?.dataUrl),
  };
}

async function writeDraft(kind, payload) {
  if (!isNative()) {
    try {
      localStorage.setItem(webKey(kind), JSON.stringify(payload));
    } catch {
      // Text-only on web; if even that will not fit there is nothing useful to do.
    }
    return;
  }
  try {
    await writeJsonFileAtomic(draftFile(kind), JSON.stringify(payload));
  } catch (err) {
    console.error(`[EntryDraft] Could not persist ${kind} draft:`, err?.message || err);
  }
}

/** Save the in-progress entry. Debounced; call flushEntryDraft() to force it out. */
export function saveEntryDraft(kind, { fields, photo }) {
  pendingWrites.set(kind, serialiseDraft(kind, { fields, photo }));
  const existing = saveTimers.get(kind);
  if (existing) clearTimeout(existing);
  saveTimers.set(kind, setTimeout(() => {
    saveTimers.delete(kind);
    const payload = pendingWrites.get(kind);
    pendingWrites.delete(kind);
    if (payload) writeDraft(kind, payload);
  }, SAVE_DEBOUNCE_MS));
}

/** Write any debounced draft out NOW. Called when the app loses the foreground. */
export async function flushEntryDraft(kind) {
  const kinds = kind ? [kind] : Array.from(pendingWrites.keys());
  await Promise.all(kinds.map(async (k) => {
    const timer = saveTimers.get(k);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(k);
    }
    const payload = pendingWrites.get(k);
    pendingWrites.delete(k);
    if (payload) await writeDraft(k, payload);
  }));
}

/** The stored draft with its photo usable again, or null. */
export async function loadEntryDraft(kind) {
  let raw = null;
  try {
    if (isNative()) {
      const stored = await readJsonFileWithRecovery(draftFile(kind));
      raw = stored && Object.keys(stored).length ? stored : null;
    } else {
      const text = localStorage.getItem(webKey(kind));
      raw = text ? JSON.parse(text) : null;
    }
  } catch (err) {
    console.error(`[EntryDraft] Could not read ${kind} draft:`, err?.message || err);
    return null;
  }

  if (!raw?.fields) return null;
  return { ...raw, photo: rehydratePhoto(raw.photo) };
}

export async function clearEntryDraft(kind) {
  const timer = saveTimers.get(kind);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(kind);
  }
  pendingWrites.delete(kind);

  if (!isNative()) {
    try { localStorage.removeItem(webKey(kind)); } catch { /* best effort */ }
    return;
  }
  try {
    await writeJsonFileAtomic(draftFile(kind), JSON.stringify({}));
  } catch {
    // A draft we cannot clear reappears as a resume banner; harmless next to losing one.
  }
}

/**
 * Worth offering back? A form opened and abandoned with nothing in it is not work worth a
 * banner — only something the guard actually put there.
 */
export function entryDraftHasContent(draft) {
  const fields = draft?.fields;
  if (!fields) return false;
  const typed = Object.values(fields).some((value) => String(value ?? '').trim());
  return typed || Boolean(draft.photo) || Boolean(draft.photoDropped);
}

/**
 * Backgrounding is the dangerous moment — it is when the camera opens and when Android is most
 * likely to reclaim the app — so the debounced write is forced out there.
 * Returns an unsubscribe function.
 */
export function installEntryDraftFlush(kind) {
  const flush = () => { flushEntryDraft(kind); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
  };
}
