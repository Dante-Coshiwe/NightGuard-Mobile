import { appendNfcScan, getNfcScans, saveNfcScans } from './deviceStore';
import { enqueueOfflineItem } from '../hooks/useOfflineQueue';

// One place where a patrol check-in is written down, used by every surface that can produce one
// (the Patrol tab, the tracking screen, the background recorder) so a scan is persisted locally
// BEFORE any network call and marked synced the same way afterwards.
//
// `post` is the offline-aware poster from useOfflineApi: it either reaches the server or queues
// the write durably, so once this returns the scan can no longer be lost.
export async function persistPatrolScan(entry, post) {
  appendNfcScan(entry);

  let result;
  try {
    result = await post('/nfc/scan', entry, {
      clientTempId: entry.id,
      offlineResponse: { ...entry, offline: true, _offline: true },
    });
  } catch (err) {
    // post() only diverts into the outbox for the errors shouldQueueFallback() recognises;
    // anything else reaches here as a throw. Every caller of this function catches and warns
    // (PatrolRecorder, the tracking screen, the background recorder), so without this the
    // checkpoint would exist ONLY in the local scan list — not on the server, not in the
    // queue, not in the dead-letter store, and the guard is still shown "points gathered"
    // because markCheckpointReached() has already run. That is a silent hole in a patrol
    // record, which is the one thing this app must never produce.
    //
    // enqueueOfflineItem() de-dupes on (method, url, data, clientTempId), so this cannot
    // double-queue a scan post() had already accepted.
    console.warn('[patrolScanStore] scan post failed; handing it to the offline queue:', err?.message || err);
    enqueueOfflineItem('post', '/nfc/scan', entry, entry.id);
    return { ...entry, offline: true, _offline: true };
  }

  if (!result?._offline) {
    saveNfcScans(getNfcScans().map((scan) => (
      String(scan.id) === String(entry.id) ? { ...scan, offline: false, _offline: false } : scan
    )));
  }

  return result;
}
