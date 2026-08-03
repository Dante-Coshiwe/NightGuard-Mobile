import React, { useEffect, useState } from 'react';
import { getDeviceId, getLastSyncAt, getLocationName, getSyncLogs } from '../lib/deviceStore';
import { getUnsyncedWriteCount } from '../hooks/useOfflineQueue';
import { OTA_CURRENT_VERSION } from '../services/liveUpdate';

export default function InfoScreen() {
  const [storageInfo, setStorageInfo] = useState({ available: 'Checking...', used: 'Checking...' });
  const [latestSyncLog, setLatestSyncLog] = useState(getSyncLogs()[0] || null);
  const [pendingWrites, setPendingWrites] = useState(getUnsyncedWriteCount());
  const locationName = getLocationName();

  useEffect(() => {
    const loadInfo = async () => {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        const quota = estimate.quota || 0;
        const usage = estimate.usage || 0;
        const free = Math.max(quota - usage, 0);
        setStorageInfo({
          available: `${(free / 1024 / 1024).toFixed(1)} MB`,
          used: `${(usage / 1024 / 1024).toFixed(1)} MB`,
        });
      }
    };

    loadInfo();

    const refresh = () => {
      setLatestSyncLog(getSyncLogs()[0] || null);
      setPendingWrites(getUnsyncedWriteCount());
    };
    window.addEventListener('nightguard_sync_complete', refresh);
    window.addEventListener('nightguard_queue_updated', refresh);
    return () => {
      window.removeEventListener('nightguard_sync_complete', refresh);
      window.removeEventListener('nightguard_queue_updated', refresh);
    };
  }, []);

  const infoCards = [
    ['Location', locationName],
    ['Application', 'NightGuard mobile client'],
    ['Version', OTA_CURRENT_VERSION],
    ['Device ID', getDeviceId()],
    ['Last Sync', getLastSyncAt() ? new Date(getLastSyncAt()).toLocaleString() : 'No sync recorded yet'],
    ['Latest Sync Status', latestSyncLog?.sync_status || 'No sync recorded yet'],
    ['Pending Uploads', pendingWrites === 0 ? 'All data synced' : `${pendingWrites} waiting to sync`],
    ['Available Storage', storageInfo.available],
    ['Used Storage', storageInfo.used],
  ];

  return (
    <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Application Info</h1>
        <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>Device and application details for this installation.</p>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {infoCards.map(([label, value]) => (
          <div key={label} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 16 }}>
            <div style={{ color: '#888', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
            <div style={{ color: '#fff', fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
