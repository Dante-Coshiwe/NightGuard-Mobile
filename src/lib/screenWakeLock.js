// Keep the screen awake while a patrol is running.
//
// Android throttles GPS hard once the screen sleeps, so a pocketed phone records almost nothing.
// A real fix is a native foreground service (needs an APK), but the Screen Wake Lock API is
// available in the Android WebView and ships over the air, so it covers the common case: the guard
// starts a patrol, the phone stays in their hand or on a stand, and the display no longer times out.
//
// The lock is released by the system whenever the page is hidden, so it must be re-acquired on
// every return to the foreground.

let wakeLock = null;
let wanted = false;
let listening = false;

function isSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquire() {
  if (!wanted || !isSupported() || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    console.log('[WakeLock] screen wake lock acquired');
  } catch (err) {
    // Denied (battery saver, unsupported WebView build). The on-screen prompt is the fallback.
    wakeLock = null;
    console.warn('[WakeLock] request failed:', err?.message || err);
  }
}

function handleVisibility() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') acquire();
}

export function requestScreenWakeLock() {
  wanted = true;
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
    listening = true;
  }
  acquire();
}

export async function releaseScreenWakeLock() {
  wanted = false;
  if (listening && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibility);
    listening = false;
  }
  const current = wakeLock;
  wakeLock = null;
  try {
    await current?.release?.();
  } catch { /* already gone */ }
}

export function isScreenWakeLockSupported() {
  return isSupported();
}
