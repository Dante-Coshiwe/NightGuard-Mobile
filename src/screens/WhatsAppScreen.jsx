import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import KioskService from '../services/kioskService';

// A configured chat/number wins; otherwise open WhatsApp itself rather than a chat.
const WHATSAPP_URL = import.meta.env.VITE_WHATSAPP_URL || '';

// `whatsapp://send` opens the app's share target. Capacitor's WebViewClient turns a
// non-http scheme into an ACTION_VIEW intent, which is what actually launches the
// installed app — so this is a plain navigation, not a link the WebView tries to render.
const WHATSAPP_APP_SCHEME = WHATSAPP_URL.startsWith('whatsapp://') ? WHATSAPP_URL : 'whatsapp://send';
const WHATSAPP_WEB_URL = WHATSAPP_URL.startsWith('http') ? WHATSAPP_URL : 'https://wa.me/';

// How long to wait before deciding the app scheme went nowhere. Long enough that a slow
// task switch is not mistaken for a failure.
const FALLBACK_DELAY_MS = 2500;

// ============================================================================
//  Opening WhatsApp from a kiosked handset.
//
//  This screen used to just navigate to `whatsapp://send` and hope. On a locked
//  device that does nothing whatsoever: Android's lock task mode refuses to start
//  any activity outside the pinned task, silently. The guard saw "Opening WhatsApp",
//  nothing happened, and the "Open WhatsApp" fallback button below did nothing
//  either — it is the same blocked navigation.
//
//  So the lock has to come off FIRST, and it has to stay off long enough for the
//  task switch to happen. KioskService.suspendForExternalApp does both: it releases
//  the lock and tells the 20-second re-lock watchdog to stand down. The shift, the
//  foreground service and the departure log are untouched — the guard is still on
//  duty, and coming back re-locks the device (see resumeFromExternalApp in App.jsx).
//
//  Two things this screen must NOT do, both of which stranded the guard outside the app:
//
//  1. Open the web fallback on top of a WhatsApp that opened perfectly well. The
//     timer below used to fire unconditionally, so ~2.5s after WhatsApp came up the
//     WebView also handed `https://wa.me/` to Capacitor's launchIntent, which starts
//     a BROWSER on it — a second task the guard has to dismiss, in front of the one
//     they asked for. The fallback is now only for the case it was written for:
//     WhatsApp is not installed, so the scheme went nowhere and we are STILL visible.
//  2. Sit on "Opening WhatsApp" once the guard is back. React Router does not remount
//     a route you are already on, so returning to a stale WhatsApp screen also made
//     the sidebar's WhatsApp button look dead. Coming back sends them home.
// ============================================================================

export default function WhatsAppScreen() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('unlocking');
  // Set the moment the app loses the foreground, i.e. WhatsApp actually opened. Read by the
  // fallback timer, so it must be a ref — the timer closes over the first render otherwise.
  const leftAppRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer = null;

    const noteBackgrounded = () => { leftAppRef.current = true; };
    const onVisibility = () => { if (document.visibilityState === 'hidden') noteBackgrounded(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', noteBackgrounded);

    // The guard is back in the app: the trip out is over, so leave this screen rather than
    // leaving them staring at "Opening WhatsApp".
    const resumed = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && leftAppRef.current && !cancelled) navigate('/', { replace: true });
      if (!isActive) noteBackgrounded();
    });

    const open = async () => {
      // Never fatal: a device where the unlock fails should still TRY to open
      // WhatsApp — kiosk may simply be switched off, in which case nothing was
      // blocking it in the first place.
      await KioskService.suspendForExternalApp('WhatsApp').catch(() => null);
      if (cancelled) return;

      setPhase('opening');
      window.location.href = WHATSAPP_APP_SCHEME;

      fallbackTimer = window.setTimeout(() => {
        // WhatsApp opened — we are in the background. Anything launched now lands on top
        // of it, so do nothing at all.
        if (cancelled || leftAppRef.current || document.visibilityState === 'hidden') return;
        setPhase('fallback');
        window.location.href = WHATSAPP_WEB_URL;
      }, FALLBACK_DELAY_MS);
    };

    open();

    return () => {
      cancelled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', noteBackgrounded);
      resumed.then((handler) => handler.remove()).catch(() => null);
    };
  }, [navigate]);

  const retry = async () => {
    await KioskService.suspendForExternalApp('WhatsApp').catch(() => null);
    window.location.href = WHATSAPP_APP_SCHEME;
  };

  return (
    <div style={{ padding: '24px 24px 40px', color: '#fff', background: '#000', minHeight: '100vh' }}>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>
        {phase === 'unlocking' ? 'Unlocking the device…' : 'Opening WhatsApp'}
      </h1>

      {/* The one screen where the guard is knowingly about to leave — say it here, not only on
          the home screen they have already scrolled past. */}
      <div style={{ margin: '0 0 16px', padding: '10px 14px', border: '1px solid #7f5310', borderRadius: 10, background: '#2a1d05', color: '#fbbf24', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
        Leaving this app is reported. The admin is notified as soon as you leave, and the device
        locks itself again the moment you come back.
      </div>

      <p style={{ color: '#8b8b8b', fontSize: 14, lineHeight: 1.5 }}>
        {phase === 'unlocking'
          ? 'Releasing the kiosk lock so WhatsApp can open.'
          : 'If WhatsApp does not open in a few seconds, tap below.'}
      </p>

      <button
        type="button"
        onClick={retry}
        style={{
          display: 'inline-block',
          marginTop: 12,
          padding: '12px 18px',
          background: '#1f7a43',
          border: 'none',
          borderRadius: 10,
          color: '#fff',
          fontWeight: 700,
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        Open WhatsApp
      </button>

      {/* The guard is about to be in another app. Tell them the way back BEFORE they go,
          because from inside WhatsApp there is nothing left to read it on. */}
      <div style={{ marginTop: 24, padding: '12px 14px', border: '1px solid #23232a', borderRadius: 10, background: '#0d0d10' }}>
        <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
          Getting back to NightGuard
        </div>
        <p style={{ color: '#8b8b8b', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Swipe down from the top of the screen and tap <strong style={{ color: '#d4d4d8' }}>Guard
          Session Active</strong>, or use the recent-apps button. You do not need to find the icon
          and start the app again.
        </p>
      </div>

      <p style={{ color: '#6b6b70', fontSize: 12, marginTop: 20, lineHeight: 1.5 }}>
        Your shift is still running. Patrol alarms still sound and tracking continues while you are
        in WhatsApp.
      </p>
    </div>
  );
}
