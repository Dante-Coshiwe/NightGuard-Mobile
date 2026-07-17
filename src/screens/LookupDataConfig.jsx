import React, { useEffect, useState } from 'react';
import { getCachedSiteSettings, getLookupData } from '../lib/deviceStore';
import { loadSiteLookupData, saveSiteLookupData } from '../services/schemaData';

const styles = {
  page: { padding: '24px 32px', color: '#fff', background: '#000', minHeight: 'var(--app-viewport-height, 100dvh)' },
  card: { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 14, padding: 20, marginBottom: 18 },
  textarea: { width: '100%', minHeight: 96, padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', boxSizing: 'border-box', resize: 'vertical' },
};

function serialiseList(text) {
  return text
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

export default function LookupDataConfig() {
  const initial = getLookupData();
  const [fields, setFields] = useState({
    shiftOptions: initial.shiftOptions.join('\n'),
    pedestrianTypes: initial.pedestrianTypes.join('\n'),
    vehicleTypes: initial.vehicleTypes.join('\n'),
    units: initial.units.join('\n'),
    incidentTypes: initial.incidentTypes.join('\n'),
  });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await loadSiteLookupData(getCachedSiteSettings());
        console.log('[LookupData] fetched from service:', data);
        setFields({
          shiftOptions: data.shiftOptions.join('\n'),
          pedestrianTypes: data.pedestrianTypes.join('\n'),
          vehicleTypes: data.vehicleTypes.join('\n'),
          units: data.units.join('\n'),
          incidentTypes: data.incidentTypes.join('\n'),
        });
      } catch (err) {
        setError(err.message || 'Unable to load lookup data');
      }
    };

    loadData();

    const handleLookupUpdate = () => {
      const data = getLookupData();
      setFields({
        shiftOptions: data.shiftOptions.join('\n'),
        pedestrianTypes: data.pedestrianTypes.join('\n'),
        vehicleTypes: data.vehicleTypes.join('\n'),
        units: data.units.join('\n'),
        incidentTypes: data.incidentTypes.join('\n'),
      });
    };

    window.addEventListener('nightguard_lookup_updated', handleLookupUpdate);
    return () => window.removeEventListener('nightguard_lookup_updated', handleLookupUpdate);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      const result = await saveSiteLookupData({
        shiftOptions: serialiseList(fields.shiftOptions),
        pedestrianTypes: serialiseList(fields.pedestrianTypes),
        vehicleTypes: serialiseList(fields.vehicleTypes),
        units: serialiseList(fields.units),
        incidentTypes: serialiseList(fields.incidentTypes),
      }, getCachedSiteSettings());
      setSuccess(result?._offline ? 'Lookup data saved locally and will sync later' : 'Lookup data saved');
    } catch (err) {
      setError(err.message || 'Failed to save lookup data');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Lookup Data</h1>
        <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>Manage the selectable values used across the app, including shifts, visitor types, and units.</p>
      </div>

      {success && <div style={{ ...styles.card, borderColor: '#166534', color: '#86efac' }}>{success}</div>}
      {error && <div style={{ ...styles.card, borderColor: '#7f1d1d', color: '#fca5a5' }}>{error}</div>}

      {[
        ['shiftOptions', 'Shift options'],
        ['pedestrianTypes', 'Pedestrian categories'],
        ['vehicleTypes', 'Vehicle categories'],
        ['units', 'Units / locations'],
        ['incidentTypes', 'Incident categories'],
      ].map(([key, label]) => (
        <div key={key} style={styles.card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>{label}</h2>
          <p style={{ color: '#8b8b8b', fontSize: 13 }}>One value per line.</p>
          <textarea
            style={styles.textarea}
            value={fields[key]}
            onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        </div>
      ))}

      <button onClick={handleSave} disabled={saving} style={{ padding: '12px 18px', background: '#dc2626', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
        {saving ? 'Saving...' : 'Save Lookup Data'}
      </button>
    </div>
  );
}
