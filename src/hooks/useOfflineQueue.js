import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { getCachedSiteSettings, reconcileShiftSessionId } from '../lib/deviceStore';
import {
  NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT,
  NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT,
  confirmAppOnline,
  dispatchConnectivityRecheck,
  isAppOnline,
} from '../lib/connectivity';
import { recordDeviceSyncLog, refreshOperationalCachesFromDatabase } from '../services/schemaData';
import { uploadPendingPhoto, uploadPendingPhotos } from '../lib/photoCapture';
import { getCachedIncidents, setCachedIncidents, getCachedObEntries, setCachedObEntries } from '../lib/reportCache';
import {
  getCachedPedestrians,
  getCachedGuards,
  getCachedVehicles,
  getNfcScans,
  saveCachedPedestrians,
  saveCachedVehicles,
  saveCachedGuards,
  saveCachedSiteSettings,
  saveLastSyncAt,
  saveNfcScans,
  getCachedPatrols,
  saveCachedPatrols,
  saveCachedReportRecipients,
  isGeneralGuardId,
} from '../lib/deviceStore';

const QUEUE_KEY = 'nightguard_offline_queue';
const DEAD_LETTER_KEY = 'nightguard_offline_queue_dead';
// Raised when the outbox itself could not be written — see saveQueue(). This is the one failure
// in the capture chain that the guard has to be told about, because it means a record they were
// shown as saved is not actually anywhere.
const QUEUE_WRITE_FAILURE_KEY = 'nightguard_offline_queue_write_failed';
export const QUEUE_WRITE_FAILED_EVENT = 'nightguard_queue_write_failed';
const OfflineQueueContext = createContext(null);
let syncInFlight = null;
let lastOnlineSyncTriggerAt = 0;
const ONLINE_SYNC_DEBOUNCE_MS = 4000;

// How often a device that still has items waiting tries again on its own.
//
// The queue used to drain only on mount and on a connectivity CHANGE. A device that was already
// online when a write failed transiently therefore sat there with a full queue and nothing to
// re-trigger it — the only way out was a human pressing "Sync Now". Site admins are not technical
// and should never be asked to; the device has everything it needs to retry by itself.
const AUTO_RETRY_INTERVAL_MS = 60000;

// A queued write must never disappear because the server said "no" once. Items that are rejected
// keep retrying up to MAX_SYNC_ATTEMPTS, then move to a dead-letter list instead of being deleted,
// so a guard's patrol is always recoverable. Dead letters are revived on app launch (conditions
// that caused the rejection — a missing site binding, an unsynced shift — are usually fixed by
// then), up to DEAD_LETTER_REVIVALS times.
const MAX_SYNC_ATTEMPTS = 8;
const DEAD_LETTER_LIMIT = 200;
const DEAD_LETTER_REVIVALS = 3;

// An entry photo that cannot be uploaded must not hold the entry hostage. The upload throws a
// plain Error with no HTTP status, so classifySyncFailure() reads it as 'retry' and re-queues the
// item *without* counting an attempt — a permanently broken upload (a missing storage bucket, a
// storage policy that rejects the anon role) therefore retried every 60s forever and the
// pedestrian/vehicle never reached the dashboard at all. Worse, the post-sync cache refresh wiped
// the local row, so the entry vanished from the guard's screen while still stuck in the outbox.
// Photo attempts are counted separately from MAX_SYNC_ATTEMPTS: exhausting them drops the *photo*
// and posts the entry with picture_url null, rather than dead-lettering the entry.
const MAX_PHOTO_ATTEMPTS = 3;

// The Supabase facade ignores axios-style { timeout }. Without this, one stalled write blocks the
// whole queue forever and `syncInFlight` never clears, so nothing syncs again until the app is
// restarted — the queue silently stops draining while the guard keeps patrolling.
const SYNC_ITEM_TIMEOUT_MS = 20000;

// EVERY await inside syncInFlight must be bounded, not just the write itself.
//
// A photo upload is a raw supabase.storage.upload() (photoCapture.js uploadEntryPhoto) and
// supabase-js sets no fetch timeout, so a half-open connection — a gate phone showing bars with no
// data, which is the normal way mobile signal dies — never settles. That await sat between the
// queue loop and everything after it, so the loop never advanced, syncInFlight never resolved, and
// because syncOfflineQueueNow() hands the SAME promise back to every later caller
// (`if (syncInFlight) return syncInFlight`), the entire outbox stopped draining until the app
// process was restarted. One stalled photo froze every queued patrol, gate entry and incident
// behind it — silently, with the banner still saying "uploading automatically".
//
// Photos get a longer budget than a write: they are up to ~1600px of JPEG on a gate's connection,
// and killing a slow-but-progressing upload just to retry it from zero is worse than waiting.
const PHOTO_UPLOAD_TIMEOUT_MS = 45000;
// The post-drain cache refresh and sync-log write are AFTER saveQueue(), so a hang there cannot
// lose queued work — but it still wedges syncInFlight permanently, which stops every future drain.
const POST_SYNC_TIMEOUT_MS = 15000;

function withSyncTimeout(promise, label, ms = SYNC_ITEM_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Sync timed out: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function canTriggerOnlineSync() {
  const now = Date.now();
  if (now - lastOnlineSyncTriggerAt < ONLINE_SYNC_DEBOUNCE_MS) {
    return false;
  }
  lastOnlineSyncTriggerAt = now;
  return true;
}

function getQueue() {
  try {
    const queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    console.log(`[OfflineQueue] getQueue(): ${queued.length} items pending`);
    return queued;
  } catch (err) {
    console.error(`[OfflineQueue] getQueue() ERROR:`, err.message);
    return [];
  }
}

// ⚠ CRUCIAL DATA PATH — this is the outbox. Everything a guard captures offline (patrols, scans,
// gate entries, incidents and their photos) exists ONLY here until it reaches Supabase.
//
// Two things to know before touching it:
//
//  * The failure handling below is a console.error and nothing else. A failed write loses the delta
//    silently — no user-visible signal, no retry. That is precisely why a queued photo's bytes must
//    live in exactly ONE storage key: duplicating megabytes into a second key is what makes this
//    write fail in the first place.
//  * On Android this `localStorage` is not the browser's — nativeStorage.js replaces it with a
//    filesystem-backed proxy, and QUEUE_KEY is in its CRITICAL_KEYS, so every call here rewrites
//    the ENTIRE storage state to disk. Cost grows with queue size; the outbox has no cap.
//
// See README.md, "Data capture and upload", risks 4 and 5.
//
// This used to be a bare try/catch whose only failure handling was a console.error, which meant a
// failed write dropped the delta with no signal and no retry — on the ADD path that is a guard's
// record gone. It now tries in earnest before giving up, and when it does give up it says so out
// loud instead of pretending the save happened.
//
// Recovery order matters. The dead-letter list is the expendable thing here: those items already
// exhausted their retries and are kept for inspection, whereas the live queue is work that has
// never reached the server. Trading the former for the latter is the right way round.
function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  // The outbox is writable again — retract the warning rather than leaving a stale one on screen
  // for the rest of the shift.
  if (localStorage.getItem(QUEUE_WRITE_FAILURE_KEY)) clearQueueWriteFailure();
}

/** Returns true when the queue is durably stored. Callers on the capture path MUST check it. */
function saveQueue(queue) {
  try {
    writeQueue(queue);
    window.dispatchEvent(new Event('nightguard_queue_updated'));
    return true;
  } catch (err) {
    console.error('[OfflineQueue] saveQueue() failed, attempting recovery:', err?.message || err);
  }

  // Second attempt with the dead letters cleared out. On Android this storage is a
  // filesystem-backed proxy whose CRITICAL_KEYS path serialises the WHOLE state on every write,
  // so dropping a couple of hundred exhausted items can be the difference on a full device.
  try {
    const sacrificed = getDeadLetterQueue().length;
    if (sacrificed) {
      localStorage.removeItem(DEAD_LETTER_KEY);
      console.warn(`[OfflineQueue] Dropped ${sacrificed} dead-lettered item(s) to make room for live work`);
    }
    writeQueue(queue);
    window.dispatchEvent(new Event('nightguard_queue_updated'));
    return true;
  } catch (err) {
    console.error('[OfflineQueue] saveQueue() failed after pruning dead letters:', err?.message || err);
  }

  // Out of options. Do NOT fail silently: the caller is about to tell a guard their entry is
  // saved, and it is not. The banner this raises is the only chance anyone has to notice before
  // the shift ends and the device is handed on.
  try {
    localStorage.setItem(QUEUE_WRITE_FAILURE_KEY, JSON.stringify({
      at: new Date().toISOString(),
      queueLength: queue.length,
    }));
  } catch { /* if even this will not fit, the event below is all that is left */ }
  window.dispatchEvent(new Event(QUEUE_WRITE_FAILED_EVENT));
  return false;
}

/** Set when the outbox could not be written. Cleared by the next write that succeeds. */
export function getQueueWriteFailure() {
  try {
    const raw = localStorage.getItem(QUEUE_WRITE_FAILURE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearQueueWriteFailure() {
  try { localStorage.removeItem(QUEUE_WRITE_FAILURE_KEY); } catch { /* best effort */ }
}

function getDeadLetterQueue() {
  try {
    return JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || '[]');
  } catch {
    return [];
  }
}

// How many writes the server has refused outright. This is NOT a backlog: a queued item is on its
// way, a dead-lettered one has stopped trying and needs a person.
//
// It existed only in storage until 2026-08-14, when an RLS misconfiguration refused a patrol, a
// gate exit and a shift on a live handset. Each was retried 8 times and dead-lettered, and the
// guard was shown "uploading automatically" the entire time, then a plain "Online". The records
// were gone from every screen while the handset still displayed the visitor as signed out. Nothing
// anywhere said a word. Counting them is what turns that into something a person can see.
export function getDeadLetterCount() {
  return getDeadLetterQueue().length;
}

function deadLetter(item, err) {
  try {
    const entry = {
      ...item,
      deadLetteredAt: new Date().toISOString(),
      lastError: err?.message || 'unknown error',
      lastStatus: err?.response?.status ?? null,
      revivals: item.revivals || 0,
    };
    const next = [entry, ...getDeadLetterQueue()].slice(0, DEAD_LETTER_LIMIT);
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(next));
    console.error(`[OfflineQueue] DEAD-LETTERED after ${item.attempts} attempts - ${item.method.toUpperCase()} ${item.url}`, entry);
  } catch (writeErr) {
    console.error('[OfflineQueue] deadLetter() write failed:', writeErr?.message || writeErr);
  }
}

// Move dead letters back onto the queue. The rejections that put them there are usually
// environmental (site binding not yet resolved, a shift row that had not synced, an RLS race), so
// a later launch often succeeds where the original attempt could not.
export function reviveDeadLetteredItems() {
  const dead = getDeadLetterQueue();
  if (!dead.length) return 0;

  const revivable = dead.filter((item) => (item.revivals || 0) < DEAD_LETTER_REVIVALS);
  const retained = dead.filter((item) => (item.revivals || 0) >= DEAD_LETTER_REVIVALS);
  if (!revivable.length) return 0;

  const queue = getQueue();
  const existing = new Set(queue.map((item) => makeQueueKey(item.method, item.url, item.data, item.clientTempId)));
  const restored = revivable
    .filter((item) => !existing.has(makeQueueKey(item.method, item.url, item.data, item.clientTempId)))
    .map((item) => ({ ...item, attempts: 0, revivals: (item.revivals || 0) + 1 }));

  try {
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(retained));
  } catch { /* keep going: requeueing matters more than pruning */ }

  if (restored.length) {
    saveQueue([...queue, ...restored]);
    console.log(`[OfflineQueue] reviveDeadLetteredItems(): requeued ${restored.length} item(s)`);
  }
  return restored.length;
}

// What to do with an item whose sync attempt failed.
//   'retry' — the request never reached the server (offline, timeout, 5xx, auth). Keep it and do
//             NOT count the attempt: a device that is offline for a week must not exhaust its
//             retries and lose the night's patrols.
//   'count' — the server rejected it. Every Supabase error surfaces as 400 here, and most are
//             transient (FK to a row that has not synced yet, RLS evaluated before the session
//             refreshed, a dropped connection), so retry a bounded number of times before
//             dead-lettering. Never delete.
//   'drop'  — terminal and safe to forget: the write already landed (409), the target is gone
//             (410), or the route does not exist (404). Retrying cannot change the outcome.
// ⚠ CRUCIAL: this decides whether a guard's record is kept or thrown away.
//
// 'drop' is terminal but no longer silent: the caller dead-letters it with `terminal: true` and
// its revivals already spent, so the evidence survives without the item being retried forever.
// 409 (conflict) is the one worth inspecting when it shows up — a conflict may mean the record is
// genuinely a duplicate, or that something else moved underneath it.
//
// 'retry' must stay the default for anything with no HTTP status: no status means the request never
// reached the server, so the attempt says NOTHING about whether the payload is acceptable and must
// not be counted against MAX_SYNC_ATTEMPTS.
// See README.md, "Data capture and upload", risk 7.
// Postgres codes that mean this exact payload can NEVER be accepted, however many times it is
// offered. Retrying them is not caution, it is a device burning a 20s timeout per drain, every
// 60s, on a write with no possible future — and with MAX_SYNC_ATTEMPTS x DEAD_LETTER_REVIVALS
// that is 32 doomed attempts each, which is what makes a wedged handset feel like it has stopped
// syncing altogether.
//
// They are dropped from the live queue but NOT destroyed: the caller dead-letters them, so the
// record is still on the device and still inspectable. Nothing here deletes a guard's work.
//
// 23503 (foreign key) is deliberately ABSENT. It looks terminal and is not: it is what a write
// referencing a shift or patrol that has not synced YET produces, and it succeeds unchanged once
// the parent lands. It stays on the counted path so it retries a bounded number of times first.
const TERMINAL_PG_CODES = new Set([
  '23502', // not_null_violation   — a required column is null; the payload is malformed
  '23505', // unique_violation     — the row is already on the server, so this one is a duplicate
  '22P02', // invalid_text_representation — a malformed uuid, e.g. a local `shift_<ts>` id
  '22007', // invalid_datetime_format
  '23514', // check_violation
]);

function classifySyncFailure(err) {
  const status = err?.response?.status;
  if (!status) return 'retry';
  if ([404, 409, 410].includes(status)) return 'drop';
  // api.js carries the original PostgREST error through as response.data.details.
  if (TERMINAL_PG_CODES.has(err?.response?.data?.details?.code)) return 'drop';
  // 403 is an RLS refusal (api.js maps PostgREST 42501 onto it). It is counted, not retried
  // forever, on purpose: the write is safely queued either way, but counting it means it
  // eventually dead-letters and OfflineBanner tells somebody. An RLS gap is fixed by a
  // person, and a device that retries it silently for a week is the 2026-08-14 failure again.
  if ([400, 403, 422].includes(status)) return 'count';
  return 'retry';
}

function normaliseQueueUrl(item) {
  if (item.method === 'post' && item.url === '/users/guards') {
    return '/shifts/guards/add';
  }
  return item.url;
}

function extractGuardPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload?.guard || payload?.user || payload;
}

function remapPayloadReferences(payload, createdIdMap) {
  if (!payload || typeof payload !== 'object') return payload;

  const mapped = { ...payload };
  ['guard_id', 'local_guard_id', 'shift_id', 'patrol_id', 'checkpoint_id'].forEach((key) => {
    if (mapped[key] && createdIdMap.has(mapped[key])) {
      mapped[key] = createdIdMap.get(mapped[key]);
    }
  });
  return mapped;
}

function replaceCachedEntity(cacheKey, clientTempId, nextEntity) {
  console.log(`[OfflineQueue] replaceCachedEntity(): key="${cacheKey}", tempId="${clientTempId}", updating with:`, nextEntity);
  const cached = cacheKey === 'cached_pedestrians' ? getCachedPedestrians() : getCachedVehicles();
  const updated = cached.map((entry) => (
    entry.id === clientTempId
      ? {
        ...entry,
        ...nextEntity,
        _offline: false,
        _pendingExit: false,
        // The card reads `photoUrl`; the server row carries `picture_url`. Adopt the uploaded
        // URL here, because the bytes were never cached (see PedestrianTab/VehicleTab) and this
        // is the only moment the real URL arrives.
        //
        // The marker is only retired once a URL actually exists. Clearing it unconditionally
        // blanks the card: most callers below pass a partial patch (an id, or an exit time),
        // so `picture_url` is usually undefined, and the entry's own photoUrl is '' precisely
        // while a photo is pending. That combination rendered a synced visitor with no photo
        // and no explanation — the picture was safely in storage and the guard could not see it.
        photoUrl: nextEntity?.picture_url || entry.photoUrl || '',
        _pendingPhotoCount: (nextEntity?.picture_url || entry.photoUrl)
          ? 0
          : (Number(entry._pendingPhotoCount) || 0),
      }
      : entry
  ));
  if (cacheKey === 'cached_pedestrians') {
    saveCachedPedestrians(updated);
    console.log(`[OfflineQueue] replaceCachedEntity(): Updated ${cacheKey} cache with synced data`);
    return;
  }
  saveCachedVehicles(updated);
  console.log(`[OfflineQueue] replaceCachedEntity(): Updated ${cacheKey} cache with synced data`);
}

function updateCachedNfcScan(clientTempId, responseData) {
  console.log(`[OfflineQueue] updateCachedNfcScan(): tempId="${clientTempId}", responseData:`, responseData);
  const scans = getNfcScans().map((scan) => (
    String(scan.id) === String(clientTempId)
      ? {
          ...scan,
          ...responseData,
          id: responseData?.scan?.id || responseData?.id || scan.id,
          offline: false,
          _offline: false,
        }
      : scan
  ));
  saveNfcScans(scans);
  console.log(`[OfflineQueue] updateCachedNfcScan(): Updated NFC scans cache`);
}

async function applySuccessfulSync(item, response) {
  const responseData = response?.data;
  if (!responseData) {
    console.log(`[OfflineQueue] applySuccessfulSync(): No response data to apply`);
    return;
  }

  const resolvedUrl = normaliseQueueUrl(item);
  const guardPayload = extractGuardPayload(responseData);

  // The device session was opened offline with a local `shift_<ts>` id; the server minted a real
  // UUID. Adopt it now, or every record written from here on sends the local id, nullableUuid()
  // nulls it on insert, and nothing is attributable to the session. createdIdMap only remaps
  // within a single drain, so it cannot cover records logged in later batches.
  if (item.url === '/shifts/start' && responseData.id) {
    reconcileShiftSessionId(item.clientTempId, responseData.id);
  }

  // Update pedestrians with synced IDs
  if (item.method === 'post' && (responseData.id || guardPayload?.id) && item.clientTempId) {
    if (item.url.includes('pedestrians')) {
      console.log(`[OfflineQueue] applySuccessfulSync(): Updating pedestrian cache with serverId=${responseData.id}`);
      // picture_url matters as much as the id: the photo was uploaded during THIS drain, and the
      // card has been holding a placeholder since capture because the bytes deliberately live in
      // the queue and not in the cache. This response is where the real URL first exists.
      replaceCachedEntity('cached_pedestrians', item.clientTempId, {
        id: responseData.id,
        picture_url: responseData.picture_url,
      });
    }
    // Update vehicles with synced IDs
    if (item.url.includes('vehicles')) {
      console.log(`[OfflineQueue] applySuccessfulSync(): Updating vehicle cache with serverId=${responseData.id}`);
      replaceCachedEntity('cached_vehicles', item.clientTempId, {
        id: responseData.id,
        picture_url: responseData.picture_url,
      });
    }
    // Update guards with synced data
    if (resolvedUrl.includes('/users/guards') || resolvedUrl.includes('/shifts/guards/add')) {
      console.log(`[OfflineQueue] applySuccessfulSync(): Updating guard cache with guardId=${guardPayload?.id}`);
      if (guardPayload && typeof guardPayload === 'object') {
        const guards = getCachedGuards().map((guard) => (
          String(guard.id) === String(item.clientTempId)
            ? { ...guard, ...guardPayload, id: guardPayload?.id || guard.id, _offline: false }
            : guard
        ));
        saveCachedGuards(guards);
      } else {
        console.warn('[OfflineQueue] applySuccessfulSync(): guardPayload invalid, skipping guard update');
      }
    }
  }

  // Update NFC scans
  if (item.url.includes('/nfc/scan') && item.clientTempId) {
    console.log(`[OfflineQueue] applySuccessfulSync(): Updating NFC scan with response id=${responseData?.id}`);
    updateCachedNfcScan(item.clientTempId, responseData);
  }

  if ((item.url === '/patrols/start' || item.url === '/patrols/complete') && item.clientTempId && responseData?.id) {
    const cached = getCachedPatrols();
    const known = cached.some((patrol) => String(patrol.id) === String(item.clientTempId));
    const updated = known
      ? cached.map((patrol) => (
        String(patrol.id) === String(item.clientTempId)
          ? { ...patrol, ...responseData, id: responseData.id, _offline: false }
          : patrol
      ))
      : [{ ...responseData, _offline: false }, ...cached];
    saveCachedPatrols(updated);
  }

  // Update pedestrian exit
  if (item.url.includes('/pedestrians/') && item.url.endsWith('/exit')) {
    const pedestrianId = item.url.split('/pedestrians/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Marking pedestrian ${pedestrianId} as exited`);
    replaceCachedEntity('cached_pedestrians', pedestrianId, {
      hasLeft: true,
      exitTime: responseData.exit_time || new Date().toISOString(),
    });
  }

  // Update vehicle exit
  if (item.url.includes('/vehicles/') && item.url.endsWith('/exit')) {
    const vehicleId = item.url.split('/vehicles/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Marking vehicle ${vehicleId} as exited`);
    replaceCachedEntity('cached_vehicles', vehicleId, {
      hasLeft: true,
      exitedAt: responseData.exited_at || new Date().toISOString(),
    });
  }

  // Update guard PIN
  if (item.url.includes('/users/guards/') && item.url.includes('/pin')) {
    const guardId = item.url.split('/users/guards/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Updated guard ${guardId} PIN`);
    const guards = getCachedGuards().map((guard) => (
      String(guard.id) === String(guardId)
        ? { ...guard, pin: item.data.pin, guard_pin: item.data.pin, _offline: false }
        : guard
    ));
    saveCachedGuards(guards);
  }

  // Update guard toggle
  if (item.url.includes('/users/guards/') && item.url.includes('/toggle')) {
    const guardId = item.url.split('/users/guards/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Toggled guard ${guardId} active status`);
    const guards = getCachedGuards().map((guard) => (
      String(guard.id) === String(guardId)
        ? { ...guard, is_active: item.data.is_active, _offline: false }
        : guard
    ));
    saveCachedGuards(guards);
  }

  // Update site settings
  if (item.url === '/sites/mine' || item.url.endsWith('/sites/mine')) {
    console.log(`[OfflineQueue] applySuccessfulSync(): Updated site settings`);
    saveCachedSiteSettings({
      ...getCachedSiteSettings(),
      ...item.data,
      ...responseData,
      _offline: false,
    });
  }

  // Update the cached report recipients once the edit actually lands.
  //
  // The response is re-read from the server by updateReportRecipientsRecord(), so it carries
  // the authoritative site_id — which is what the cache is keyed on. Writing item.data here
  // instead would cache a payload with no site_id and the screen would refuse to show it,
  // which looks exactly like the save having been lost.
  if (item.url === '/report-recipients/mine' && responseData?.site_id) {
    console.log('[OfflineQueue] applySuccessfulSync(): Updated report recipients');
    saveCachedReportRecipients({ ...responseData, _offline: false });
  }

  // Update cached incidents so the UI can reflect queued reports immediately.
  if (item.url === '/incidents/report' && item.clientTempId && responseData?.id) {
    try {
      const cached = await getCachedIncidents();
      const updated = cached.map((inc) => (
        String(inc.id) === String(item.clientTempId)
          ? { ...inc, ...responseData, id: responseData.id, _offline: false }
          : inc
      ));
      const replaced = updated.some((inc) => String(inc.id) === String(responseData.id));
      const finalised = replaced ? updated : [{ ...responseData, _offline: false }, ...updated];
      await setCachedIncidents(finalised);
      console.log('[OfflineQueue] applySuccessfulSync(): Updated cached_incidents');
    } catch (err) {
      console.warn('[OfflineQueue] applySuccessfulSync(): Failed to update cached_incidents:', err?.message || err);
    }
  }

  // Update cached OB entries so the UI can reflect queued entries immediately.
  if (item.url === '/obentries/create' && item.clientTempId && responseData?.id) {
    try {
      const cached = await getCachedObEntries();
      const updated = cached.map((entry) => (
        String(entry.id) === String(item.clientTempId)
          ? { ...entry, ...responseData, id: responseData.id, _offline: false }
          : entry
      ));
      const replaced = updated.some((entry) => String(entry.id) === String(responseData.id));
      const finalised = replaced ? updated : [{ ...responseData, _offline: false }, ...updated];
      await setCachedObEntries(finalised);
      console.log('[OfflineQueue] applySuccessfulSync(): Updated cached_ob_entries');
    } catch (err) {
      console.warn('[OfflineQueue] applySuccessfulSync(): Failed to update cached_ob_entries:', err?.message || err);
    }
  }
}

// The key must include the endpoint. `clientTempId` alone is NOT unique: a patrol posts both
// /patrols/start and /patrols/complete under the same patrol id, so keying on the id alone made
// the completion look like a duplicate of the start and silently discarded it — every patrol run
// offline lost its end time, its status and its entire walked route.
function makeQueueKey(method, url, data, clientTempId) {
  return clientTempId
    ? `${method}:${url}:${clientTempId}`
    : `${method}:${url}:${JSON.stringify(data || {})}`;
}

export function enqueueOfflineItem(method, url, data, clientTempId = null) {
  const isGuardMutation = String(url || '').includes('/users/guards') || String(url || '').includes('/shifts/guards');
  const guardPayload = extractGuardPayload(data);
  if (isGuardMutation && (guardPayload?._is_general_guard || isGeneralGuardId(guardPayload?.id || clientTempId))) {
    console.log('[OfflineQueue] General Guard is local-only; skipping sync queue item');
    return getQueue();
  }

  const queue = getQueue();
  const itemKey = makeQueueKey(method, url, data, clientTempId);
  const exists = queue.some((item) => makeQueueKey(item.method, item.url, item.data, item.clientTempId) === itemKey);

  if (exists) {
    console.log(`[OfflineQueue] enqueueOfflineItem(): DUPLICATE SKIPPED - ${method} ${url}`);
    return queue;
  }

  const next = [
    ...queue,
    {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      method,
      url,
      data,
      timestamp: new Date().toISOString(),
      clientTempId,
      attempts: 0,
    },
  ];
  console.log(`[OfflineQueue] enqueueOfflineItem(): QUEUED - ${method} ${url}, clientId="${clientTempId}"`, data);
  saveQueue(next);
  return next;
}

export async function syncOfflineQueueNow() {
  if (syncInFlight) {
    console.log(`[OfflineQueue] syncOfflineQueueNow(): SYNC ALREADY IN FLIGHT - SKIPPED`);
    return syncInFlight;
  }

  if (!isAppOnline()) {
    console.log(`[OfflineQueue] syncOfflineQueueNow(): OFFLINE - NO SYNC`);
    return { syncedCount: 0, failedCount: getQueue().length };
  }

  syncInFlight = (async () => {
    const queue = getQueue();
    const startedAt = new Date().toISOString();
    console.log(`[OfflineQueue] SYNC STARTED - ${queue.length} items to sync at ${startedAt}`);
    
    if (queue.length === 0) {
      console.log(`[OfflineQueue] SYNC COMPLETED - Queue empty`);
      return { syncedCount: 0, failedCount: 0 };
    }

    const failed = [];
    let syncedCount = 0;
    const createdIdMap = new Map();

    for (const item of queue) {
      try {
        const guardPayload = extractGuardPayload(item.data);
        if ((item.url.includes('/users/guards') || item.url.includes('/shifts/guards')) &&
          (guardPayload?._is_general_guard || isGeneralGuardId(guardPayload?.id || item.clientTempId))) {
          console.log('[OfflineQueue] SYNC SKIP - General Guard is local-only');
          continue;
        }
        console.log(`[OfflineQueue] SYNC ITEM - ${item.method.toUpperCase()} ${item.url}`, item.data);
        let resolvedUrl = normaliseQueueUrl(item);

        if (item.url.includes('/pedestrians/') && item.url.endsWith('/exit')) {
          const pedId = item.url.split('/pedestrians/')[1]?.split('/')[0];
          if (createdIdMap.has(pedId)) {
            resolvedUrl = `/pedestrians/${createdIdMap.get(pedId)}/exit`;
            console.log(`[OfflineQueue] SYNC ITEM - remapped pedestrian exit URL: ${resolvedUrl}`);
          }
        }

        if (item.url.includes('/vehicles/') && item.url.endsWith('/exit')) {
          const vehicleId = item.url.split('/vehicles/')[1]?.split('/')[0];
          if (createdIdMap.has(vehicleId)) {
            resolvedUrl = `/vehicles/${createdIdMap.get(vehicleId)}/exit`;
            console.log(`[OfflineQueue] SYNC ITEM - remapped vehicle exit URL: ${resolvedUrl}`);
          }
        }

        let remappedData = remapPayloadReferences(item.data, createdIdMap);

        // Upload any photo captured while offline, then post the entry with the resulting URL.
        // A few retries are worth it so a transient storage blip does not cost the picture, but
        // the upload must never gate the entry itself: the guard's record of who came on site is
        // worth more than the photo of them. See MAX_PHOTO_ATTEMPTS.
        // An incident carries a set of photos rather than the single entry picture a vehicle or a
        // pedestrian has. Same contract as below: retried a few times, then posted without them —
        // the guard's account of the incident must reach the dashboard either way.
        if (remappedData && remappedData._pendingPhotos?.length) {
          const photoAttempts = (item.photoAttempts || 0) + 1;
          let uploadedUrls = [];
          let photoFailure = null;

          try {
            uploadedUrls = await withSyncTimeout(
              uploadPendingPhotos({
                pendingPhotos: remappedData._pendingPhotos,
                type: 'incidents',
                tempId: item.clientTempId || String(item.id),
                siteId: remappedData.site_id,
              }),
              'incident photos',
              PHOTO_UPLOAD_TIMEOUT_MS,
            );
          } catch (photoErr) {
            photoFailure = photoErr;
          }

          if (photoFailure && photoAttempts < MAX_PHOTO_ATTEMPTS) {
            failed.push({ ...item, photoAttempts, lastError: photoFailure.message || 'photo upload failed' });
            console.log(`[OfflineQueue] SYNC - incident photo upload failed (attempt ${photoAttempts}/${MAX_PHOTO_ATTEMPTS}), incident kept queued: ${photoFailure.message}`);
            continue;
          }

          if (photoFailure) {
            console.warn(`[OfflineQueue] SYNC - Giving up on incident photos after ${photoAttempts} attempts, posting incident without them: ${photoFailure.message}`);
          }

          const { _pendingPhotos, ...rest } = remappedData;
          const mergedUrls = uploadedUrls.length
            ? uploadedUrls
            : (Array.isArray(rest.photo_urls) ? rest.photo_urls : []);
          remappedData = { ...rest, photo_urls: mergedUrls, picture_url: mergedUrls[0] || rest.picture_url || null };
          if (!photoFailure) {
            console.log(`[OfflineQueue] SYNC - Uploaded ${uploadedUrls.length} queued incident photo(s)`);
          }
        }

        if (remappedData && remappedData._pendingPhoto) {
          const photoType = item.url.includes('/vehicles') ? 'vehicles' : 'pedestrians';
          const photoAttempts = (item.photoAttempts || 0) + 1;
          let uploadedUrl = null;
          let photoFailure = null;

          try {
            uploadedUrl = await withSyncTimeout(
              uploadPendingPhoto({
                pendingPhoto: remappedData._pendingPhoto,
                type: photoType,
                tempId: item.clientTempId || String(item.id),
                siteId: remappedData.site_id,
              }),
              `${photoType} photo`,
              PHOTO_UPLOAD_TIMEOUT_MS,
            );
          } catch (photoErr) {
            photoFailure = photoErr;
          }

          if (photoFailure && photoAttempts < MAX_PHOTO_ATTEMPTS) {
            // Keep the photo and try again on the next drain. Counted, unlike a transient
            // network failure, so a permanently broken upload cannot spin here forever.
            failed.push({ ...item, photoAttempts, lastError: photoFailure.message || 'photo upload failed' });
            console.log(`[OfflineQueue] SYNC - ${photoType} photo upload failed (attempt ${photoAttempts}/${MAX_PHOTO_ATTEMPTS}), entry kept queued: ${photoFailure.message}`);
            continue;
          }

          if (photoFailure) {
            console.warn(`[OfflineQueue] SYNC - Giving up on ${photoType} photo after ${photoAttempts} attempts, posting entry without it: ${photoFailure.message}`);
          }

          const { _pendingPhoto, ...rest } = remappedData;
          remappedData = { ...rest, picture_url: uploadedUrl || rest.picture_url || null };
          if (!photoFailure) {
            console.log(`[OfflineQueue] SYNC - Uploaded queued ${photoType} photo -> ${uploadedUrl ? 'ok' : 'no url'}`);
          }
        }

        const response = await withSyncTimeout(api[item.method](resolvedUrl, remappedData), resolvedUrl);
        confirmAppOnline('offline-queue-sync-success');
        const responseEntityId = response?.data?.id || extractGuardPayload(response?.data)?.id;
        
        console.log(`[OfflineQueue] SYNC SUCCESS - ${item.method.toUpperCase()} ${resolvedUrl}, responseId=${responseEntityId}`, response?.data);
        
        if (item.method === 'post' && item.clientTempId && responseEntityId) {
          createdIdMap.set(item.clientTempId, responseEntityId);
          console.log(`[OfflineQueue] SYNC - Mapped tempId "${item.clientTempId}" -> "${responseEntityId}"`);
        }
        await applySuccessfulSync(item, response);
        syncedCount += 1;
      } catch (err) {
        console.error(`[OfflineQueue] SYNC ERROR - ${item.method.toUpperCase()} ${item.url}:`, err.message, err?.response?.status);
        const disposition = classifySyncFailure(err);

        if (disposition === 'drop') {
          // Terminal, but NOT untraceable. This used to `continue` straight past, so an item that
          // reached here left no record anywhere and could never be inspected or replayed — and a
          // 409 in particular may mean the record is a genuine duplicate OR that something moved
          // underneath it, and there was no way to tell which afterwards. Dead-lettering it costs
          // one bounded-size entry and keeps the evidence. It is marked so a revival never puts a
          // known-terminal item back on the queue to fail again.
          // See README.md, "Data capture and upload", risk 7.
          console.log(`[OfflineQueue] SYNC - Item dropped (terminal ${err?.response?.status})`);
          deadLetter({ ...item, terminal: true, revivals: DEAD_LETTER_REVIVALS }, err);
          continue;
        }

        if (disposition === 'retry') {
          // Never reached the server, so the attempt says nothing about the payload.
          failed.push(item);
          console.log('[OfflineQueue] SYNC - Item kept (transient failure, attempt not counted)');
          // Connectivity died mid-drain. Stop here and keep the rest intact rather than burning
          // a 20s timeout on every remaining item while the guard waits.
          if (!isAppOnline()) {
            const remaining = queue.slice(queue.indexOf(item) + 1);
            failed.push(...remaining);
            console.log(`[OfflineQueue] SYNC - Went offline mid-sync, deferring ${remaining.length} remaining item(s)`);
            break;
          }
          continue;
        }

        const attempted = { ...item, attempts: (item.attempts || 0) + 1, lastError: err?.message || 'rejected' };
        if (attempted.attempts >= MAX_SYNC_ATTEMPTS) {
          deadLetter(attempted, err);
        } else {
          failed.push(attempted);
          console.log(`[OfflineQueue] SYNC - Item kept (rejected, attempt ${attempted.attempts}/${MAX_SYNC_ATTEMPTS})`);
        }
      }
    }

    saveQueue(failed);
    console.log(`[OfflineQueue] SYNC - Queue updated: ${syncedCount} synced, ${failed.length} failed/pending`);

    if (syncedCount > 0) {
      // Both are timeboxed for the same reason as the uploads above: .catch() does not rescue a
      // promise that never settles, and a hang here leaves syncInFlight pinned forever, which
      // stops every future drain even though the queue itself is already safely saved.
      await withSyncTimeout(
        refreshOperationalCachesFromDatabase(getCachedSiteSettings()),
        'post-sync cache refresh',
        POST_SYNC_TIMEOUT_MS,
      ).catch(() => null);
      saveLastSyncAt();
      await withSyncTimeout(
        recordDeviceSyncLog({
          syncType: 'offline_queue',
          syncStatus: failed.length ? 'partial' : 'completed',
          recordsSynced: syncedCount,
          startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: failed.length ? `${failed.length} items still pending` : '',
        }, getCachedSiteSettings()),
        'device sync log',
        POST_SYNC_TIMEOUT_MS,
      ).catch(() => null);
      window.dispatchEvent(new Event('nightguard_sync_complete'));
      console.log(`[OfflineQueue] SYNC COMPLETED - final status: ${failed.length ? 'PARTIAL' : 'FULL'}`);
    }

    return { syncedCount, failedCount: failed.length };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

function useOfflineQueueController() {
  const [isOnline, setIsOnline] = useState(isAppOnline());
  const [queueCount, setQueueCount] = useState(getQueue().length);
  const [deadCount, setDeadCount] = useState(getDeadLetterCount());
  const [syncing, setSyncing] = useState(false);

  const addToQueue = useCallback((method, url, data, clientTempId = null) => {
    const next = enqueueOfflineItem(method, url, data, clientTempId);
    setQueueCount(next.length);
  }, []);

  const syncQueue = useCallback(async () => {
    if (!isAppOnline()) return;
    setSyncing(true);
    try {
      const result = await syncOfflineQueueNow();
      setQueueCount(getQueue().length);
      // Read AFTER the drain: a sync is precisely when items give up and land here.
      setDeadCount(getDeadLetterCount());
      return result;
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const updateCount = () => {
      setQueueCount(getQueue().length);
      setDeadCount(getDeadLetterCount());
    };
    const handleOnline = async () => {
      const online = isAppOnline();
      setIsOnline(online);
      if (!online) return;
      if (!canTriggerOnlineSync()) return;
      await syncQueue();
    };
    const handleOffline = async () => {
      const online = await dispatchConnectivityRecheck('queue-offline-event');
      setIsOnline(online);
      if (!online) {
        setSyncing(false);
      }
    };
    const handleConnectivityChange = (event) => {
      const online = Boolean(event?.detail?.online);
      setIsOnline(online);
      if (!online) {
        setSyncing(false);
      }
    };

    // Give previously rejected writes another chance now that the app has re-launched.
    reviveDeadLetteredItems();
    updateCount();
    if (isAppOnline() && getQueue().length > 0 && canTriggerOnlineSync()) {
      syncQueue();
    }

    // Keep trying on our own. Nothing here waits for the guard or the admin to notice a banner:
    // if the device is online and still holding writes, it retries until the queue is empty.
    const autoRetry = setInterval(() => {
      if (!isAppOnline() || getQueue().length === 0) return;
      syncQueue();
    }, AUTO_RETRY_INTERVAL_MS);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('nightguard_queue_updated', updateCount);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT, handleConnectivityChange);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);

    return () => {
      clearInterval(autoRetry);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('nightguard_queue_updated', updateCount);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT, handleConnectivityChange);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, [syncQueue]);

  return useMemo(() => ({
    isOnline,
    queueCount,
    deadCount,
    syncing,
    addToQueue,
    syncQueue,
  }), [isOnline, queueCount, deadCount, syncing, addToQueue, syncQueue]);
}

// Total writes still waiting to reach the server, including rejected ones parked in the
// dead-letter list. Surfaced on the Info screen so a device holding unsent patrols is visible
// before the guard hands it over.
export function getUnsyncedWriteCount() {
  return getQueue().length + getDeadLetterQueue().length;
}

export function OfflineQueueProvider({ children }) {
  const value = useOfflineQueueController();
  return createElement(OfflineQueueContext.Provider, { value }, children);
}

export function useOfflineQueue() {
  const context = useContext(OfflineQueueContext);
  if (!context) {
    throw new Error('useOfflineQueue must be used within OfflineQueueProvider');
  }
  return context;
}
