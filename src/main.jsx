import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import './index.css';
import { installConnectivityMonitor } from './lib/connectivity';
import { installMobileKeyboardWorkarounds } from './lib/mobileKeyboard';
import { installNativeStoragePersistence } from './lib/nativeStorage';
import { notifyLiveUpdateReady, runOtaUpdate } from './services/liveUpdate';

// Check our self-hosted Supabase OTA service for a newer web bundle. Staged
// updates apply on the next background/restart, so this never interrupts a
// running shift. Fire-and-forget; no-op on web.
function scheduleOtaCheck() {
  runOtaUpdate().then((result) => {
    if (result?.status === 'staged') {
      console.info('[LiveUpdate] update staged:', result.version);
    }
  }).catch(() => { /* handled inside runOtaUpdate */ });
}

async function installOtaForegroundCheck() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) scheduleOtaCheck();
    });
  } catch { /* @capacitor/app unavailable */ }
}

// Kiosked devices can stay foregrounded for days and never fire a resume event,
// so also re-check on a timer. 30 min keeps rollouts bounded without hammering.
const OTA_PERIODIC_CHECK_MS = 30 * 60 * 1000;

async function bootstrap() {
  // Confirm to the updater that this (possibly just-installed) OTA bundle booted,
  // so it isn't rolled back. Fire-and-forget so it never delays startup; it's a
  // no-op on the web build.
  notifyLiveUpdateReady();

  await installNativeStoragePersistence();
  await installConnectivityMonitor();
  await installMobileKeyboardWorkarounds();

  const [
    { default: App },
    { initDeviceId, seedGeneralGuard },
    { OfflineQueueProvider },
  ] = await Promise.all([
    import('./App'),
    import('./lib/deviceStore'),
    import('./hooks/useOfflineQueue'),
  ]);

  await initDeviceId();
  await seedGeneralGuard();

  // Check for a newer bundle now that the device id exists (so every check-in is
  // attributable), again whenever the app resumes, and on a timer for kiosks.
  scheduleOtaCheck();
  installOtaForegroundCheck();
  if (Capacitor.isNativePlatform()) {
    setInterval(scheduleOtaCheck, OTA_PERIODIC_CHECK_MS);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <OfflineQueueProvider>
        <App />
      </OfflineQueueProvider>
    </React.StrictMode>
  );

  if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.log('SW registration failed:', err);
      });
    });
  }
}

bootstrap().catch((err) => {
  console.error('App bootstrap failed:', err);
});
