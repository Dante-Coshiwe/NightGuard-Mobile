import React, { useState, useEffect } from 'react';
import { getMySite, updateMySite } from '../services/api';

export default function SettingsConfig() {
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editable fields
  const [siteName, setSiteName] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Toggles
  const [autoExit, setAutoExit] = useState(() => localStorage.getItem('autoExit') === 'true');
  const [deviceDescription, setDeviceDescription] = useState(() => localStorage.getItem('deviceDescription') || '');

  useEffect(() => {
    loadSite();
  }, []);

  const loadSite = async () => {
    setLoading(true);
    try {
      const data = await getMySite();
      setSite(data);
      setSiteName(data.site_name || '');
      setAddress(data.address || '');
      setContactPerson(data.contact_person || '');
      setContactPhone(data.contact_phone || '');
    } catch (err) {
      setError('Failed to load site settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await updateMySite({ site_name: siteName, address, contact_person: contactPerson, contact_phone: contactPhone });
      localStorage.setItem('autoExit', autoExit);
      localStorage.setItem('deviceDescription', deviceDescription);
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const Section = ({ title, children }) => (
    <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <h2 style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: 1, color: '#666' }}>{title}</h2>
      {children}
    </div>
  );

  const Field = ({ label, children, readonly }) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ color: readonly ? '#555' : '#999', fontSize: 12, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}{readonly && ' (read-only)'}</label>
      {children}
    </div>
  );

  const inputStyle = (readonly) => ({
    width: '100%',
    padding: '10px 12px',
    background: readonly ? '#0d0d0d' : '#111',
    border: `1px solid ${readonly ? '#1a1a1a' : '#2a2a2a'}`,
    borderRadius: 8,
    color: readonly ? '#555' : '#fff',
    fontSize: 14,
    boxSizing: 'border-box',
    cursor: readonly ? 'not-allowed' : 'text',
  });

  const Toggle = ({ label, description, value, onChange }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
      <div style={{ flex: 1, marginRight: 16 }}>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#555', fontSize: 12 }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: value ? '#dc2626' : '#333',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: value ? 23 : 3, transition: 'left 0.2s'
        }} />
      </button>
    </div>
  );

  if (loading) return (
    <div style={{ padding: 32, color: '#666', textAlign: 'center' }}>Loading settings...</div>
  );

  return (
    <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh', maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Site Settings</h1>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '10px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: 8, padding: '10px 16px', color: '#ff6b6b', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ background: '#0a2a1a', border: '1px solid #1a5a3a', borderRadius: 8, padding: '10px 16px', color: '#6bff9e', fontSize: 13, marginBottom: 16 }}>{success}</div>}

      {/* Site Info */}
      <Section title="Site Information">
        <Field label="Site ID">
          <input value={site?.id || ''} readOnly style={inputStyle(true)} onClick={e => { e.target.select(); document.execCommand('copy'); }} title="Click to copy" />
          <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Click to copy · Cannot be changed</div>
        </Field>
        <Field label="Site Name">
          <input value={siteName} onChange={e => setSiteName(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Address">
          <input value={address} onChange={e => setAddress(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Contact Person">
          <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Contact Phone">
          <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} style={inputStyle(false)} />
        </Field>
        <Field label="Organisation">
          <input value={site?.organizations?.org_name || ''} readOnly style={inputStyle(true)} />
        </Field>
      </Section>

      {/* Device Info */}
      {site?.devices?.length > 0 && (
        <Section title="Device Information">
          {site.devices.map((device, i) => (
            <div key={i} style={{ marginBottom: i < site.devices.length - 1 ? 16 : 0 }}>
              <Field label="Device ID">
                <input value={device.device_id || ''} readOnly style={inputStyle(true)} onClick={e => { e.target.select(); document.execCommand('copy'); }} title="Click to copy" />
              </Field>
              <Field label="Device Name">
                <input value={device.device_name || ''} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="App Version">
                <input value={device.app_version || '-'} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="Last Sync">
                <input value={device.latest_sync_update ? new Date(device.latest_sync_update).toLocaleString() : 'Never'} readOnly style={inputStyle(true)} />
              </Field>
              <Field label="Device Description (kept on device)">
                <textarea
                  value={deviceDescription}
                  onChange={e => setDeviceDescription(e.target.value)}
                  rows={3}
                  placeholder="Add notes about this device..."
                  style={{ ...inputStyle(false), resize: 'vertical' }}
                />
              </Field>
            </div>
          ))}
        </Section>
      )}

      {/* Automation Toggles */}
      <Section title="Automation">
        <Toggle
          label="Auto-Exit at Midnight"
          description="Automatically marks all pedestrians and vehicles as exited and ends all active guard shifts at midnight. Useful for sites that operate on a daily basis — ensures data stays clean for the next day without manual intervention."
          value={autoExit}
          onChange={setAutoExit}
        />
      </Section>
    </div>
  );
}