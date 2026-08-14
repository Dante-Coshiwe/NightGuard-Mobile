import { Capacitor } from '@capacitor/core';
import { readJsonFileWithRecovery, writeJsonFileAtomic } from './atomicFile';
import { buildPendingPhoto, dataUrlToBlob } from './photoCapture';

// ============================================================================
//  An unfinished incident report must survive the app going away.
//
//  The wizard held everything in React state alone, so anything that destroyed
//  the JS context threw away the guard's account of what happened AND the
//  photos they had just taken, with no error and nothing to recover.
//
//  That is not a rare event, and OTA is only the most recent cause:
//
//   * Taking a photo launches an external activity (camera or picker). On a
//     low-RAM handset Android routinely reclaims the app behind it — the guard
//     comes back to an empty form and no explanation. No OTA change prevents
//     this one.
//   * A mandatory bundle applied inline mid-form (see the applyNow gate in
//     services/liveUpdate.js — that is what reloaded the app under a photo on
//     2026-08-14).
//   * Any WebView crash or OOM kill.
//
//  WHERE THIS IS STORED MATTERS. Photos are base64 and run to megabytes; the
//  offline queue lives in localStorage and `saveQueue()` handles a quota
//  exception with nothing but a console.error, silently discarding the entire
//  outbox. Putting draft photos in the same quota risks costing a guard every
//  queued write to save one unsent form. So on native the draft goes to the
//  filesystem, like reportCache does — never localStorage.
//
//  On web there is no Filesystem plugin and no camera round-trip to survive, so
//  the draft keeps TEXT ONLY. Dropping the photos there is deliberate: it is the
//  same quota trap, and the browser case it protects does not exist.
// ============================================================================

const DRAFT_FILE = 'nightguard-incident-draft.json';
const WEB_DRAFT_KEY = 'nightguard_incident_draft';

// Long enough that typing does not rewrite a megabyte of base64 on every
// keystroke, short enough to be well inside any pause. Backgrounding flushes
// immediately regardless — see installIncidentDraftFlush.
const SAVE_DEBOUNCE_MS = 1200;

let saveTimer = null;
let pendingWrite = null;

function isNative() {
  return Boolean(Capacitor?.isNativePlatform?.());
}

// A Blob does not survive JSON.stringify (it becomes `{}`), so only the data URL
// is stored — exactly what the offline queue does for a pending photo.
function serialisePhoto(photo) {
  return buildPendingPhoto(photo);
}

// uploadEntryPhotos() filters on `p?.blob`, so a restored photo without one is
// silently dropped and the picture is lost on submit. Rebuild it from the data URL.
function rehydratePhoto(photo) {
  if (!photo?.dataUrl) return null;
  try {
    return { ...photo, blob: dataUrlToBlob(photo.dataUrl) };
  } catch {
    return null;
  }
}

function serialiseDraft({ formData, currentStep }) {
  const keepPhotos = isNative();
  return {
    savedAt: new Date().toISOString(),
    currentStep: currentStep || 1,
    formData: {
      ...formData,
      vehiclePhoto: keepPhotos ? serialisePhoto(formData?.vehiclePhoto) : null,
      incidentPhotos: keepPhotos
        ? (formData?.incidentPhotos || []).map(serialisePhoto).filter(Boolean)
        : [],
    },
    // So a restored draft can say honestly that the pictures did not come back.
    photosDropped: keepPhotos
      ? 0
      : (formData?.incidentPhotos?.length || 0) + (formData?.vehiclePhoto ? 1 : 0),
  };
}

async function writeDraft(payload) {
  if (!isNative()) {
    try {
      localStorage.setItem(WEB_DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // Text-only on web; if even that will not fit there is nothing useful to do.
    }
    return;
  }
  try {
    await writeJsonFileAtomic(DRAFT_FILE, JSON.stringify(payload));
  } catch (err) {
    console.error('[IncidentDraft] Could not persist draft:', err?.message || err);
  }
}

/** Save the in-progress report. Debounced; call flushIncidentDraft() to force it out. */
export function saveIncidentDraft({ formData, currentStep }) {
  pendingWrite = serialiseDraft({ formData, currentStep });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const payload = pendingWrite;
    pendingWrite = null;
    if (payload) writeDraft(payload);
  }, SAVE_DEBOUNCE_MS);
}

/** Write any debounced draft out NOW. Called when the app loses the foreground. */
export async function flushIncidentDraft() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const payload = pendingWrite;
  pendingWrite = null;
  if (payload) await writeDraft(payload);
}

/** The stored draft with its photos usable again, or null. */
export async function loadIncidentDraft() {
  let raw = null;
  try {
    if (isNative()) {
      const stored = await readJsonFileWithRecovery(DRAFT_FILE);
      raw = stored && Object.keys(stored).length ? stored : null;
    } else {
      const text = localStorage.getItem(WEB_DRAFT_KEY);
      raw = text ? JSON.parse(text) : null;
    }
  } catch (err) {
    console.error('[IncidentDraft] Could not read draft:', err?.message || err);
    return null;
  }

  if (!raw?.formData) return null;

  return {
    ...raw,
    formData: {
      ...raw.formData,
      vehiclePhoto: rehydratePhoto(raw.formData.vehiclePhoto),
      incidentPhotos: (raw.formData.incidentPhotos || []).map(rehydratePhoto).filter(Boolean),
    },
  };
}

export async function clearIncidentDraft() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingWrite = null;

  if (!isNative()) {
    try { localStorage.removeItem(WEB_DRAFT_KEY); } catch { /* best effort */ }
    return;
  }
  try {
    await writeJsonFileAtomic(DRAFT_FILE, JSON.stringify({}));
  } catch {
    // A draft we cannot clear reappears as a resume banner; harmless next to losing one.
  }
}

/**
 * Worth offering back? A wizard opened and abandoned on step 1 with nothing typed is
 * not work worth a banner — only something the guard actually put in.
 */
export function draftHasContent(draft) {
  const form = draft?.formData;
  if (!form) return false;
  const typed = [
    form.category, form.address, form.complainantName, form.complainantContact,
    form.incidentWith, form.guardName, form.details, form.actionTaken,
    form.offenderDetails, form.offenderAddress, form.registration, form.makeModel, form.colour,
  ].some((value) => String(value || '').trim());
  return typed
    || Boolean(form.vehiclePhoto)
    || (form.incidentPhotos || []).length > 0
    || Number(draft.photosDropped) > 0;
}

/**
 * Backgrounding is the dangerous moment — it is when the camera opens and when Android
 * is most likely to reclaim the app — so the debounced write is forced out there.
 * Returns an unsubscribe function.
 */
export function installIncidentDraftFlush() {
  const flush = () => { flushIncidentDraft(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
  };
}
