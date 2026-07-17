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
