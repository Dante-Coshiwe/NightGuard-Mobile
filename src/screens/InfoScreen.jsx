import React, { useEffect, useState } from 'react';
import { getDeviceId, getLastSyncAt, getLocationName, getSyncLogs } from '../lib/deviceStore';

export default function InfoScreen() {
  const [storageInfo, setStorageInfo] = useState({ available: 'Checking...', used: 'Checking...' });
  const [deviceMemory, setDeviceMemory] = useState('Unavailable');
  const [latestSyncLog, setLatestSyncLog] = useState(getSyncLogs()[0] || null);
  const locationName = getLocationName();

  useEffect(() => {
    const loadInfo = async () => {
      if (navigator.deviceMemory) {
        setDeviceMemory(`${navigator.deviceMemory} GB`);
      }

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

    const refresh = () => setLatestSyncLog(getSyncLogs()[0] || null);
    window.addEventListener('nightguard_sync_complete', refresh);
    return () => window.removeEventListener('nightguard_sync_complete', refresh);
  }, []);

  const infoCards = [
    ['Location', locationName],
    ['Application', 'NightGuard mobile client'],
    ['Version', import.meta.env.VITE_APP_VERSION || '1.0.0'],
    ['Device ID', getDeviceId()],
    ['Last Sync', getLastSyncAt() ? new Date(getLastSyncAt()).toLocaleString() : 'No sync recorded yet'],
    ['Latest Sync Status', latestSyncLog?.sync_status || 'No sync recorded yet'],
    ['Available Storage', storageInfo.available],
    ['Used Storage', storageInfo.used],
    ['Approx. Device Memory', deviceMemory],
    ['Browser', navigator.userAgent],
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
