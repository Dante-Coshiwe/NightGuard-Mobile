import React, { useEffect, useState } from 'react';
import {
  QUEUE_WRITE_FAILED_EVENT,
  getQueueWriteFailure,
  useOfflineQueue,
} from '../hooks/useOfflineQueue';

// A write that uploads in a second is not news. Anything queued clears well inside this, so the
// banner stays out of the way during normal use and only appears when there is something a person
// would actually want to know about.
const SETTLE_DELAY_MS = 5000;

// Status only — never a request for action.
//
// This used to offer a "Sync Now" button whenever items were waiting, which read to a
// non-technical site admin as a chore they had to remember to do, and made an ordinary few
// seconds of catching up look like a fault. The device retries by itself (see
// AUTO_RETRY_INTERVAL_MS in useOfflineQueue), so the only job here is to reassure: the work is
// saved, and it is going up on its own.
export default function OfflineBanner() {
  const { isOnline, queueCount, deadCount, syncing } = useOfflineQueue();
  const hasBacklog = queueCount > 0 || syncing;
  // Offline is worth saying immediately — it changes what the guard should expect. A backlog that
  // is busy clearing itself is not, so it has to persist before it earns any screen space.
  const [backlogSettled, setBacklogSettled] = useState(false);

  // The outbox itself could not be written. This is the one condition here that is a genuine
  // fault rather than a status: it means a record the guard was shown as saved is not on disk,
  // and nothing will retry it. See saveQueue() in useOfflineQueue.
  const [writeFailure, setWriteFailure] = useState(() => getQueueWriteFailure());

  useEffect(() => {
    const onFailure = () => setWriteFailure(getQueueWriteFailure() || { at: new Date().toISOString() });
    const onQueueChange = () => setWriteFailure(getQueueWriteFailure());
    window.addEventListener(QUEUE_WRITE_FAILED_EVENT, onFailure);
    window.addEventListener('nightguard_queue_updated', onQueueChange);
    return () => {
      window.removeEventListener(QUEUE_WRITE_FAILED_EVENT, onFailure);
      window.removeEventListener('nightguard_queue_updated', onQueueChange);
    };
  }, []);

  useEffect(() => {
    if (!hasBacklog) {
      setBacklogSettled(false);
      return undefined;
    }
    const timer = setTimeout(() => setBacklogSettled(true), SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasBacklog]);

  // Outranks everything below, and is deliberately not dismissible — the alternative is a guard
  // finishing a shift believing entries were captured that were not.
  if (writeFailure) {
    return (
      <div
        className="offline-banner"
        role="alert"
        style={{
          position: 'fixed',
          right: 12,
          bottom: 86,
          zIndex: 91,
          maxWidth: 'min(88vw, 340px)',
          background: 'rgba(127, 29, 29, 0.97)',
          color: '#fee2e2',
          padding: '10px 12px',
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.3,
          borderRadius: 12,
          border: '1px solid rgba(248, 113, 113, 0.55)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}
      >
        Storage is full — the last entry may not have been saved. Free up space on this device and
        tell your supervisor.
      </div>
    );
  }

  // The server took the record and refused it. Unlike a backlog this will NOT clear on its own —
  // it has already been retried to exhaustion — so it gets said plainly, immediately, and with no
  // settle delay. It also outranks the ordinary status below, because a device holding a rejected
  // patrol must never render as "All data synced".
  //
  // On 2026-08-14 an RLS misconfiguration refused a patrol, a gate exit and a shift on a live
  // handset. The screen said "uploading automatically", then "Online", and the visitor still
  // showed as signed out. Silence is what made that dangerous, not the refusal.
  //
  // Deliberately not dismissible, and deliberately does not offer a retry: the app already revives
  // these by itself on launch, and once the cause is fixed they go up without anybody pressing
  // anything. What it asks for is the one thing the device cannot do — tell a person.
  if (deadCount > 0) {
    return (
      <div
        className="offline-banner"
        role="alert"
        style={{
          position: 'fixed',
          right: 12,
          bottom: 86,
          zIndex: 92,
          maxWidth: 'min(88vw, 340px)',
          background: 'rgba(127, 29, 29, 0.97)',
          color: '#fee2e2',
          padding: '10px 12px',
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.3,
          borderRadius: 12,
          border: '1px solid rgba(248, 113, 113, 0.55)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}
      >
        {`${deadCount} record${deadCount !== 1 ? 's' : ''} the server would not accept. `}
        {deadCount !== 1 ? 'They are' : 'It is'} still saved on this device. Tell your supervisor —
        {deadCount !== 1 ? ' they' : ' it'} will upload once the account is fixed.
      </div>
    );
  }

  if (isOnline && !(hasBacklog && backlogSettled)) {
    return null;
  }

  return (
    <div
      className="offline-banner"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 86,
        zIndex: 90,
        maxWidth: 'min(88vw, 340px)',
        background: isOnline ? 'rgba(22, 101, 52, 0.94)' : 'rgba(127, 29, 29, 0.94)',
        color: isOnline ? '#dcfce7' : '#fee2e2',
        padding: '8px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        minHeight: 34,
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 12,
        border: isOnline ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(248, 113, 113, 0.35)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(8px)',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
      }}
    >
      <span style={{ lineHeight: 1.25 }}>
        {isOnline
          ? syncing
            ? `Uploading ${queueCount} item${queueCount !== 1 ? 's' : ''}…`
            : queueCount > 0
              // Not a warning and not a to-do: it uploads by itself, and saying so stops an admin
              // hunting for the button that used to be here.
              ? `${queueCount} item${queueCount !== 1 ? 's' : ''} saved — uploading automatically`
              : 'Online • All data synced'
          : `Offline • ${queueCount} item${queueCount !== 1 ? 's' : ''} saved on this device`}
      </span>
    </div>
  );
}
