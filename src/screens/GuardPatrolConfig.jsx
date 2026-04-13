import React, { useState } from 'react';
import { getPatrolConfig, savePatrolConfig } from '../lib/deviceStore';

const styles = {
  page: { padding: '24px 32px', color: '#fff', background: '#000', minHeight: '100vh' },
  card: { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 14, padding: 20, marginBottom: 18 },
  input: { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', boxSizing: 'border-box' },
};

export default function GuardPatrolConfig() {
  const [config, setConfig] = useState(getPatrolConfig());
  const [success, setSuccess] = useState('');

  const updateCheckpoint = (id, key, value) => {
    setConfig((prev) => ({
      ...prev,
      checkpoints: prev.checkpoints.map((checkpoint) => (
        checkpoint.id === id ? { ...checkpoint, [key]: value } : checkpoint
      )),
    }));
  };

  const addCheckpoint = () => {
    setConfig((prev) => ({
      ...prev,
      checkpoints: [
        ...prev.checkpoints,
        { id: `cp-${Date.now()}`, name: '', tag_uid: '', zone: '', required: true },
      ],
    }));
  };

  const handleSave = () => {
    savePatrolConfig(config);
    setSuccess('Guard patrol configuration saved on this device');
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Guard Patrol Configuration</h1>
        <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>Configure patrol schedule enforcement, checkpoint count, and NFC tag mappings.</p>
      </div>

      {success && <div style={{ ...styles.card, borderColor: '#166534', color: '#86efac' }}>{success}</div>}

      <div style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Schedule</h2>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label>
            <div style={{ color: '#a3a3a3', marginBottom: 6 }}>Patrol schedule toggle</div>
            <select style={styles.input} value={String(config.patrolScheduleEnabled)} onChange={(e) => setConfig({ ...config, patrolScheduleEnabled: e.target.value === 'true' })}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label>
            <div style={{ color: '#a3a3a3', marginBottom: 6 }}>Patrol interval (minutes)</div>
            <input style={styles.input} type="number" min="5" value={config.patrolIntervalMinutes} onChange={(e) => setConfig({ ...config, patrolIntervalMinutes: Number(e.target.value) })} />
          </label>
          <label>
            <div style={{ color: '#a3a3a3', marginBottom: 6 }}>Required NFC tags count</div>
            <input style={styles.input} type="number" min="1" value={config.minimumTagCount} onChange={(e) => setConfig({ ...config, minimumTagCount: Number(e.target.value) })} />
          </label>
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>NFC Checkpoints</h2>
            <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>These tags are matched when a guard scans patrol points.</p>
          </div>
          <button onClick={addCheckpoint} style={{ padding: '10px 16px', background: '#151515', border: '1px solid #333', borderRadius: 10, color: '#fff', cursor: 'pointer' }}>
            Add Checkpoint
          </button>
        </div>

        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          {config.checkpoints.map((checkpoint) => (
            <div key={checkpoint.id} style={{ border: '1px solid #1f1f1f', borderRadius: 12, padding: 14, background: '#111' }}>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <input style={styles.input} value={checkpoint.name} onChange={(e) => updateCheckpoint(checkpoint.id, 'name', e.target.value)} placeholder="Checkpoint name" />
                <input style={styles.input} value={checkpoint.tag_uid} onChange={(e) => updateCheckpoint(checkpoint.id, 'tag_uid', e.target.value)} placeholder="NFC tag UID" />
                <input style={styles.input} value={checkpoint.zone} onChange={(e) => updateCheckpoint(checkpoint.id, 'zone', e.target.value)} placeholder="Zone" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={handleSave} style={{ padding: '12px 18px', background: '#dc2626', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
        Save Configuration
      </button>
    </div>
  );
}
