import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listBindableSites } from '../lib/siteResolver';
import { isAppOnline } from '../lib/connectivity';
import { getDeviceId } from '../lib/deviceStore';
import { NIGHTGUARD_LOGO } from '../lib/nightguardLogo';
import { hasAdminPinHash } from '../services/kioskPinService';
import './screens.css';

// Shown once, to a manager who holds more than one site, on a device that has
// never been bound. The choice is permanent: everything this device records from
// here on is filed against the site picked here.
export default function SelectSiteScreen() {
  const [sites, setSites] = useState(null);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { completeSiteBinding, logout } = useAuth();
  const navigate = useNavigate();

  // A guard who reaches this screen is holding an unprovisioned device — the
  // only way forward is a manager signing in, so give them that door rather
  // than a dead end.
  const handleSignInAsAdmin = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    let mounted = true;
    listBindableSites()
      .then((rows) => {
        if (!mounted) return;
        // Alphabetical, always. my_sites() does not promise an order, and a manager holding a
        // dozen sites is scanning this list for one name — an arbitrary order makes them hunt,
        // and this is a choice they only get to make once per device.
        const ordered = [...(rows || [])].sort((a, b) => (
          String(a?.site_name || '').localeCompare(String(b?.site_name || ''), undefined, { sensitivity: 'base' })
        ));
        setSites(ordered);
        if (ordered.length === 1) setSelected(ordered[0].id);
      })
      .catch((err) => {
        if (!mounted) return;
        setSites([]);
        setError(err?.message || 'Could not load your sites');
      });
    return () => { mounted = false; };
  }, []);

  const handleConfirm = async (e) => {
    e.preventDefault();
    const site = (sites || []).find((s) => s.id === selected);
    if (!site) {
      setError('Pick a location first');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await completeSiteBinding(site);
      if (!(await hasAdminPinHash())) {
        navigate('/setup/kiosk-pin', { replace: true, state: { initialSetup: true } });
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Could not bind this device');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-inner">
        <div className="login-brand">
          <img className="login-brand-logo" src={NIGHTGUARD_LOGO} alt="Night-Guard Security" />
          <h1 className="login-brand-title">Choose this device&rsquo;s location</h1>
          <p className="login-brand-copy">
            Everything recorded on this device is filed against the location you pick. It is set once
            and cannot be changed from the device.
          </p>
        </div>

        {error && <div className="status-banner error">{error}</div>}

        {sites === null && <div className="status-banner neutral">Loading your locations&hellip;</div>}

        {sites !== null && sites.length === 0 && (
          <div className="login-stack">
            <div className="status-banner error">
              {isAppOnline()
                ? 'No locations are assigned to this account. Ask a super admin to add you to a location, then sign in again.'
                : 'This device is offline. Connect to the internet to choose a location — it has to be confirmed with the server before the device can record anything.'}
            </div>
            <button className="button-submit" type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
            <button className="button-text" type="button" onClick={handleSignInAsAdmin}>
              Sign in as a manager
            </button>
          </div>
        )}

        {sites !== null && sites.length > 0 && (
          <form onSubmit={handleConfirm} className="login-stack">
            <div className="login-section-title">Location</div>
            <div>
              <label className="login-label" htmlFor="site-select">Assign this device to</label>
              <select
                id="site-select"
                className="form-input"
                value={selected}
                onChange={(e) => { setSelected(e.target.value); setError(''); }}
                required
              >
                <option value="">Select a location&hellip;</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.org_name ? `${site.site_name} — ${site.org_name}` : site.site_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="status-banner neutral">
              Device ID: {getDeviceId() || 'resolving…'}
            </div>

            <button className="button-submit primary" type="submit" disabled={saving || !selected}>
              {saving ? 'Binding…' : 'Bind this device'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
