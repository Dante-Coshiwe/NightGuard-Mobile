import React, { useEffect } from 'react';

const WHATSAPP_URL = import.meta.env.VITE_WHATSAPP_URL || 'https://wa.me/';

export default function WhatsAppScreen() {
  useEffect(() => {
    const appUrl = WHATSAPP_URL.startsWith('whatsapp://') ? WHATSAPP_URL : 'whatsapp://send';
    const fallback = window.setTimeout(() => {
      window.location.replace(WHATSAPP_URL);
    }, 900);

    window.location.href = appUrl;
    return () => window.clearTimeout(fallback);
  }, []);

  return (
    <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh' }}>
      <h1 style={{ marginTop: 0 }}>Opening WhatsApp</h1>
      {/* The one screen where the guard is knowingly about to leave — say it here, not only on
          the home screen they have already scrolled past. */}
      <div style={{ margin: '0 0 16px', padding: '10px 14px', border: '1px solid #7f5310', borderRadius: 10, background: '#2a1d05', color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>
        Leaving this app is reported. The admin is notified as soon as you leave.
      </div>
      <p style={{ color: '#8b8b8b' }}>If WhatsApp does not open automatically, tap below.</p>
      <a
        href={WHATSAPP_URL}
        style={{ display: 'inline-block', marginTop: 12, padding: '10px 14px', background: '#1f7a43', borderRadius: 10, color: '#fff', textDecoration: 'none', fontWeight: 600 }}
      >
        Open WhatsApp
      </a>
    </div>
  );
}
