import { appendNfcScan, getNfcScans, saveNfcScans } from './deviceStore';

// One place where a patrol check-in is written down, used by every surface that can produce one
// (the Patrol tab, the tracking screen, the background recorder) so a scan is persisted locally
// BEFORE any network call and marked synced the same way afterwards.
//
// `post` is the offline-aware poster from useOfflineApi: it either reaches the server or queues
// the write durably, so once this returns the scan can no longer be lost.
export async function persistPatrolScan(entry, post) {
  appendNfcScan(entry);

  const result = await post('/nfc/scan', entry, {
    clientTempId: entry.id,
    offlineResponse: { ...entry, offline: true, _offline: true },
  });

  if (!result?._offline) {
    saveNfcScans(getNfcScans().map((scan) => (
      String(scan.id) === String(entry.id) ? { ...scan, offline: false, _offline: false } : scan
    )));
  }

  return result;
}
