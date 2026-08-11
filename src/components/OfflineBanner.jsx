import React, { useEffect, useState } from 'react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

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
  const { isOnline, queueCount, syncing } = useOfflineQueue();
  const hasBacklog = queueCount > 0 || syncing;
  // Offline is worth saying immediately — it changes what the guard should expect. A backlog that
  // is busy clearing itself is not, so it has to persist before it earns any screen space.
  const [backlogSettled, setBacklogSettled] = useState(false);

  useEffect(() => {
    if (!hasBacklog) {
      setBacklogSettled(false);
      return undefined;
    }
    const timer = setTimeout(() => setBacklogSettled(true), SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasBacklog]);

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
