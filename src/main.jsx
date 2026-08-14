import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import './index.css';
import { installConnectivityMonitor } from './lib/connectivity';
import { installMobileKeyboardWorkarounds } from './lib/mobileKeyboard';
import { installNativeStoragePersistence } from './lib/nativeStorage';
import { installLiveUpdateAutomation, notifyLiveUpdateReady } from './services/liveUpdate';

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

  // Keep the bundle current on its own, now that the device id exists (so every
  // check-in is attributable): check on launch, on resume and on a timer, and install
  // what has downloaded as soon as the device is idle and off shift. Nobody has to
  // press the Settings button — that is the manual override, not the mechanism.
  installLiveUpdateAutomation({ periodicCheckMs: OTA_PERIODIC_CHECK_MS });

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
