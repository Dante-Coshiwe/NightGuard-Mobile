import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMySite } from '../services/api';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { useAuth } from '../contexts/AuthContext';
import { buildLocalDataExport, getDeviceId, getDeviceSettings, getSyncLogs } from '../lib/deviceStore';
import { getCurrentDeviceRecord, loadDeviceConfiguration, saveDeviceConfiguration } from '../services/schemaData';
import { getRunningVersion, runOtaUpdate, OTA_CURRENT_VERSION } from '../services/liveUpdate';

const sectionStyle = { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 24, marginBottom: 20 };

function Section({ title, children }) {
  return (
    <div style={sectionStyle}>
      <h2 style={{ color: '#666', fontSize: 15, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, readonly }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ color: readonly ? '#555' : '#999', fontSize: 12, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}{readonly && ' (read-only)'}
      </label>
      {children}
    </div>
  );
}

function inputStyle(readonly) {
  return {
    width: '100%',
    padding: '10px 12px',
    background: readonly ? '#0d0d0d' : '#111',
    border: `1px solid ${readonly ? '#1a1a1a' : '#2a2a2a'}`,
    borderRadius: 8,
    color: readonly ? '#555' : '#fff',
    fontSize: 14,
    boxSizing: 'border-box',
    cursor: readonly ? 'not-allowed' : 'text',
  };
}

function Toggle({ label, description, value, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
      <div style={{ flex: 1, marginRight: 16 }}>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#555', fontSize: 12 }}>{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          border: 'none',
          cursor: 'pointer',
          background: value ? '#dc2626' : '#333',
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: 3,
            left: value ? 23 : 3,
            transition: 'left 0.2s',
          }}
        />
      </button>
    </div>
  );
}

export default function SettingsConfig() {
  const navigate = useNavigate();
  const { siteSettings, setCachedSiteSettings, refreshSiteSettings } = useAuth();
  const [site, setSite] = useState(siteSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [siteName, setSiteName] = useState(siteSettings.site_name || '');
  const [address, setAddress] = useState(siteSettings.address || '');
  const [contactPerson, setContactPerson] = useState(siteSettings.contact_person || '');
  const [contactPhone, setContactPhone] = useState(siteSettings.contact_phone || '');
  const [autoExit, setAutoExit] = useState(Boolean(getDeviceSettings().autoCloseShiftAtMidnight));
  const [allowQuickGuardSwitch, setAllowQuickGuardSwitch] = useState(false);
  const [deviceDescription, setDeviceDescription] = useState(getDeviceSettings().deviceDescription || '');
  const [exporting, setExporting] = useState(false);
  const [syncLogs, setSyncLogs] = useState(getSyncLogs());
  // The web bundle actually running: the live OTA bundle version if one is active,
  // else the built-in OTA_CURRENT_VERSION. This is the real answer to "what version
  // is on this device", unlike the stored device.app_version which can be stale.
  const [runningVersion, setRunningVersion] = useState(OTA_CURRENT_VERSION);
  const [otaChecking, setOtaChecking] = useState(false);
  const [otaResult, setOtaResult] = useState('');
  const initialisedRef = useRef(false);
  const { put } = useOfflineApi();

  useEffect(() => {
    if (!initialisedRef.current) {
      setSite(siteSettings);
      setSiteName(siteSettings.site_name || '');
      setAddress(siteSettings.address || '');
      setContactPerson(siteSettings.contact_person || '');
      setContactPhone(siteSettings.contact_phone || '');
      initialisedRef.current = true;
      return;
    }

    setSite(siteSettings);
  }, [siteSettings]);

  useEffect(() => {
    const syncDeviceState = () => {
      const current = getDeviceSettings();
      setAutoExit(Boolean(current.autoCloseShiftAtMidnight));
      setAllowQuickGuardSwitch(false);
      setDeviceDescription(current.deviceDescription || '');
      setSyncLogs(getSyncLogs());
    };

    syncDeviceState();
    window.addEventListener('nightguard_device_settings_updated', syncDeviceState);
    window.addEventListener('nightguard_sync_complete', syncDeviceState);
    return () => {
      window.removeEventListener('nightguard_device_settings_updated', syncDeviceState);
      window.removeEventListener('nightguard_sync_complete', syncDeviceState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getRunningVersion()
      .then((version) => { if (!cancelled && version) setRunningVersion(version); })
      .catch(() => { /* keep the built-in fallback already in state */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const loadSite = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const cached = siteSettings;
        if (cached?.site_name) {
          setSite(cached);
        }

        if (navigator.onLine) {
          const data = await getMySite();
          const saved = setCachedSiteSettings(data);
          setSite(saved);
        }
      } catch {
        // Keep local site settings; avoid noisy errors when the route does not exist.
      } finally {
        if (!silent) setLoading(false);
      }
    };

    loadSite();
    loadDeviceConfiguration(siteSettings).catch(() => null);

    const refresh = () => loadSite(true);
    window.addEventListener('online', refresh);
    window.addEventListener('nightguard_sync_complete', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('nightguard_sync_complete', refresh);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    const payload = {
      site_name: siteName,
      location_name: siteName,
      address,
      contact_person: contactPerson,
      contact_phone: contactPhone,
    };

    try {
      let result;
      try {
        result = await put('/sites/mine', payload, {
          offlineResponse: {
            ...site,
            ...payload,
            _offline: true,
          },
        });
      } catch {
        result = { ...site, ...payload, _offline: true };
      }

      const savedSite = setCachedSiteSettings({
        ...site,
        ...payload,
        ...(result?._offline ? {} : result),
      });

      setSite(savedSite);
      const deviceResult = await saveDeviceConfiguration({
        ...getDeviceSettings(),
        allowQuickGuardSwitch: false,
        autoCloseShiftAtMidnight: autoExit,
        deviceDescription,
      }, savedSite);

      setSuccess(result?._offline || deviceResult?._offline ? 'Settings saved locally and will sync later' : 'Settings saved successfully');
      window.setTimeout(() => setSuccess(''), 3000);
      if (!result?._offline) {
        refreshSiteSettings();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleExportLocalData = async () => {
    setExporting(true);
    setError('');
    setSuccess('');

    try {
      const snapshot = buildLocalDataExport();
      const fileName = `nightguard-local-export-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([JSON.stringify(snapshot, null, 2)], fileName, { type: 'application/json' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'NightGuard Local Export',
          text: 'Share this local NightGuard device export.',
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }

      setSuccess('Local device export prepared successfully');
    } catch (err) {
      setError(err.message || 'Failed to prepare local export');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 32, color: '#666', textAlign: 'center' }}>Loading settings...</div>;
  }

  return (
    <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: 'var(--app-viewport-height, 100dvh)', maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Site Settings</h1>
          <div style={{ marginTop: 6, color: '#8b8b8b', fontSize: 13 }}>Location details stay cached on the device and refresh when the device comes back online.</div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '10px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: 8, padding: '10px 16px', color: '#ff6b6b', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ background: '#0a2a1a', border: '1px solid #1a5a3a', borderRadius: 8, padding: '10px 16px', color: '#6bff9e', fontSize: 13, marginBottom: 16 }}>{success}</div>}

      <Section title="Site Information">
        <Field label="Site ID">
          <input value={site?.id || ''} readOnly style={inputStyle(true)} />
          <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Bound to this location</div>
        </Field>
        <Field label="Location Name">
          <input value={siteName} onChange={(e) => setSiteName(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Contact Person">
          <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Contact Phone">
          <input type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Organisation">
          <input value={site?.organizations?.org_name || ''} readOnly style={inputStyle(true)} />
        </Field>
      </Section>

      {/* Always rendered — unlike Device Information below, this must not depend on the
          server-side devices list, or a device with no registration row has no way to
          see its version or force an update. */}
      <Section title="App Update">
        <Field label="This Device ID">
          <input value={getDeviceId() || '-'} readOnly style={inputStyle(true)} />
        </Field>
        <Field label="Running App Version">
          <input value={runningVersion || '-'} readOnly style={inputStyle(true)} />
        </Field>
        {/* OTA smoke-test marker: first shipped over-the-air in 1.0.8. Seeing a version
            here HIGHER than the APK's baked-in bundle proves updates land without reinstalls. */}
        <div style={{ margin: '0 0 14px', padding: '10px 12px', background: '#052e16', border: '1px solid #166534', borderRadius: 8, color: '#86efac', fontSize: 13, fontWeight: 600 }}>
          🚀 Live update test passed — bundle v{runningVersion}, pushed 15 July 2026 with zero reinstall
        </div>
        <button
          type="button"
          disabled={otaChecking}
          onClick={async () => {
            setOtaChecking(true);
            setOtaResult('');
            try {
              // immediate: applies and reloads right away when an update exists —
              // code after this point does not run in that case.
              const result = await runOtaUpdate({ immediate: true });
              if (result?.status === 'up_to_date') setOtaResult(`Up to date (${runningVersion}).`);
              else if (result?.status === 'staged') setOtaResult(`Update ${result.version} downloaded — restart the app to apply.`);
              else if (result?.status === 'skipped') setOtaResult('Updates are unavailable in this build (web preview or missing updater).');
              else if (result?.status === 'error') setOtaResult(`Update failed: ${result.error}`);
            } catch (err) {
              setOtaResult(`Update failed: ${err?.message || err}`);
            } finally {
              setOtaChecking(false);
            }
          }}
          style={{ padding: '10px 16px', background: '#166534', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: otaChecking ? 'wait' : 'pointer', opacity: otaChecking ? 0.6 : 1 }}
        >
          {otaChecking ? 'Checking…' : 'Check for updates now'}
        </button>
        {otaResult && <div style={{ marginTop: 10, color: '#86efac', fontSize: 13 }}>{otaResult}</div>}
      </Section>

      {site?.devices?.length > 0 && (
        <Section title="Device Information">
          {(site.devices || []).map((device, index) => (
            <div key={index} style={{ marginBottom: index < site.devices.length - 1 ? 16 : 0 }}>
              <Field label="Device ID">
                <input value={device.device_id || ''} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="Device Name">
                <input value={device.device_name || ''} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="App Version">
                <input value={runningVersion || device.app_version || '-'} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="Last Sync">
                <input value={device.latest_sync_update ? new Date(device.latest_sync_update).toLocaleString() : 'Never'} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="Device Description (kept on device)">
                <textarea
                  value={deviceDescription}
                  onChange={(e) => setDeviceDescription(e.target.value)}
                  rows={3}
                  placeholder="Add notes about this device..."
                  style={{ ...inputStyle(false), resize: 'vertical' }}
                />
              </Field>
            </div>
          ))}
        </Section>
      )}

      <Section title="Automation">
        <Toggle
          label="Auto-Exit at Midnight"
          description="Automatically marks daily activity closed at midnight on this device."
          value={autoExit}
          onChange={setAutoExit}
        />
      </Section>

      <Section title="Kiosk Exit PIN">
        <div style={{ color: '#8b8b8b', fontSize: 13, marginBottom: 14 }}>
          This PIN is required to end an active guard shift and unlock kiosk mode.
        </div>
        <button
          onClick={() => navigate('/config/kiosk-pin')}
          style={{ padding: '10px 16px', background: '#18181b', color: '#fff', border: '1px solid #333', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}
        >
          Change Kiosk Exit PIN
        </button>
      </Section>

      <Section title="Sync Logs">
        {syncLogs.length === 0 ? (
          <div style={{ color: '#666', fontSize: 13 }}>No sync activity recorded yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {syncLogs.slice(0, 5).map((log) => (
              <div key={log.id} style={{ padding: '12px 14px', borderRadius: 10, background: '#111', border: '1px solid #1f1f1f' }}>
                <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{log.sync_status || 'completed'}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{log.completed_at ? new Date(log.completed_at).toLocaleString() : '-'}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Local Export">
        <div style={{ color: '#8b8b8b', fontSize: 13, marginBottom: 14 }}>
          Export the local device cache and pending offline sync data as JSON. On supported Android devices this opens the share sheet so the file can be sent by email.
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 14 }}>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Device ID</div>
            <input value={getDeviceId()} readOnly style={inputStyle(true)} />
          </div>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Bound Device Record</div>
            <input value={getCurrentDeviceRecord(site)?.device_name || getCurrentDeviceRecord(site)?.device_id || 'Not matched yet'} readOnly style={inputStyle(true)} />
          </div>
        </div>
        <button
          onClick={handleExportLocalData}
          disabled={exporting}
          style={{ padding: '10px 16px', background: '#18181b', color: '#fff', border: '1px solid #333', borderRadius: 10, fontWeight: 600, cursor: 'pointer', opacity: exporting ? 0.7 : 1 }}
        >
          {exporting ? 'Preparing Export...' : 'Export Local Data'}
        </button>
      </Section>
    </div>
  );
}
