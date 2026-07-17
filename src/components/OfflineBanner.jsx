import React from 'react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

export default function OfflineBanner() {
  const { isOnline, queueCount, syncing, syncQueue } = useOfflineQueue();

  if (isOnline && queueCount === 0 && !syncing) {
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
            ? `Syncing ${queueCount} pending item${queueCount !== 1 ? 's' : ''}...`
            : queueCount > 0
              ? `Online • ${queueCount} item${queueCount !== 1 ? 's' : ''} waiting to sync`
              : 'Online • All data synced'
          : `Offline • ${queueCount} item${queueCount !== 1 ? 's' : ''} saved locally`}
      </span>
      {isOnline && queueCount > 0 && !syncing && (
        <button
          onClick={syncQueue}
          style={{
            padding: '2px 8px',
            background: '#fff',
            color: '#166534',
            border: 'none',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Sync Now
        </button>
      )}
    </div>
  );
}
