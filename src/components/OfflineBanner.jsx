import React from 'react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

export default function OfflineBanner() {
  const { isOnline, queueCount, syncing, syncQueue } = useOfflineQueue();

  if (isOnline && queueCount === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: isOnline ? '#166534' : '#7f1d1d',
        color: isOnline ? '#86efac' : '#fecaca',
        padding: '8px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <div>
        {isOnline
          ? syncing
            ? `Syncing ${queueCount} pending item${queueCount !== 1 ? 's' : ''}...`
            : `Back online • ${queueCount} item${queueCount !== 1 ? 's' : ''} waiting to sync`
          : `Offline • ${queueCount} item${queueCount !== 1 ? 's' : ''} saved locally`}
      </div>
      {isOnline && queueCount > 0 && !syncing && (
        <button
          onClick={syncQueue}
          style={{
            padding: '4px 12px',
            background: '#fff',
            color: '#166534',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Sync Now
        </button>
      )}
    </div>
  );
}
