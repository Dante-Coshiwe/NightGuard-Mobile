import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GENERAL_GUARD, getCachedSiteSettings } from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';

const pageStyles = {
  page: { padding: '24px 32px', color: '#fff', background: '#000', minHeight: 'var(--app-viewport-height, 100dvh)' },
  card: { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 18 },
  button: { padding: '10px 16px', background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' },
  subtleButton: { padding: '8px 12px', background: '#151515', border: '1px solid #333', borderRadius: 10, color: '#d4d4d4', cursor: 'pointer' },
};

export default function UsersConfig() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const site = getCachedSiteSettings();

  return (
    <div style={pageStyles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Users Configuration</h1>
          <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>This device now uses one location admin account and one shared guard identity.</p>
        </div>
        <button style={pageStyles.subtleButton} onClick={async () => { await logout(); navigate('/login'); }}>
          Logout Admin
        </button>
      </div>

      <div style={pageStyles.card}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Location Admin</h2>
        <div style={{ color: '#8b8b8b', fontSize: 14 }}>
          Admin access is managed through the authenticated profile for {site.site_name || site.location_name || 'this location'}.
        </div>
      </div>

      <div style={pageStyles.card}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>General Guard</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>{GENERAL_GUARD.full_name}</div>
          <div style={{ color: '#8b8b8b', fontSize: 14 }}>All shift, patrol, visitor, vehicle, OB, and incident activity is exported under this shared guard identity.</div>
          <div style={{ color: '#86efac', fontSize: 13, marginTop: 4 }}>Active on this device</div>
        </div>
      </div>

      <div style={pageStyles.card}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Removed From Device Flow</h2>
        <div style={{ color: '#8b8b8b', fontSize: 14, lineHeight: 1.6 }}>
          Separate guard names, guard PINs, quick guard switching, and per-guard activation are no longer used by the app.
        </div>
      </div>
    </div>
  );
}
