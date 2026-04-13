import React, { useState } from 'react';
import { getLookupData, saveLookupData } from '../lib/deviceStore';

const styles = {
  page: { padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh' },
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

  const handleSave = () => {
    saveLookupData({
      shiftOptions: serialiseList(fields.shiftOptions),
      pedestrianTypes: serialiseList(fields.pedestrianTypes),
      vehicleTypes: serialiseList(fields.vehicleTypes),
      units: serialiseList(fields.units),
      incidentTypes: serialiseList(fields.incidentTypes),
    });
    setSuccess('Lookup data saved');
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Lookup Data</h1>
        <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>Manage the selectable values used across the app, including shifts, visitor types, and units.</p>
      </div>

      {success && <div style={{ ...styles.card, borderColor: '#166534', color: '#86efac' }}>{success}</div>}

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

      <button onClick={handleSave} style={{ padding: '12px 18px', background: '#dc2626', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
        Save Lookup Data
      </button>
    </div>
  );
}
