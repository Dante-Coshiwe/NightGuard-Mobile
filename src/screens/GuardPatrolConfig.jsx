import React, { useEffect, useRef, useState } from 'react';
import { getCachedSiteSettings, getNfcScans, getPatrolConfig } from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';
import { loadPatrolConfiguration, savePatrolConfiguration } from '../services/schemaData';
import NotificationService from '../services/notificationService';
import { useGeolocation } from '../hooks/useGeolocation';
import { isValidCoordinate } from '../lib/geo';
import { isNfcReaderAvailable, listenForNfcTags, nfcStatus } from '../lib/nfcReader';
import CheckpointMap from '../components/CheckpointMap';

const styles = {
  page: { padding: '24px 32px', color: '#fff', background: '#000', minHeight: 'var(--app-viewport-height, 100dvh)', height: 'var(--app-viewport-height, 100dvh)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', boxSizing: 'border-box' },
  card: { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 14, padding: 20, marginBottom: 18 },
  input: { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', boxSizing: 'border-box' },
  button: { padding: '10px 16px', background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' },
  subtleBtn: { padding: '8px 12px', background: '#151515', border: '1px solid #333', borderRadius: 10, color: '#d4d4d4', cursor: 'pointer', fontSize: 13 },
  nfcBtn: { padding: '8px 12px', background: '#1a2a1a', border: '1px solid #166534', borderRadius: 10, color: '#86efac', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  nfcBtnActive: { padding: '8px 12px', background: '#166534', border: '1px solid #22c55e', borderRadius: 10, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  dangerCard: { background: '#0a0a0a', border: '1px solid #7f1d1d', borderRadius: 14, padding: 20, marginBottom: 18 },
  fieldError: { color: '#fca5a5', fontSize: 12, marginTop: 5 },
};

const TAG_READ_TIMEOUT_MS = 20000;

// Assigning a tag to a checkpoint has to read that tag. Two things here never worked in the APK:
// `window.Nfc` is a global no plugin ever defined, and `NDEFReader` (Web NFC) is a Chrome API that
// is not exposed to a WebView. So the native reader is tried first; Web NFC stays only for the
// admin panel running in a real browser.
async function readNfcTag() {
  if (isNfcReaderAvailable()) {
    // Ask the adapter FIRST. Without this a phone with no NFC chip, or with NFC switched off,
    // simply sat on the 20 s timeout and then blamed the guard for not holding the tag close
    // enough — the one thing that was never the problem.
    const status = await nfcStatus();
    if (!status.available) throw new Error('This phone has no NFC reader. Set the checkpoint by GPS instead.');
    if (!status.enabled) throw new Error('NFC is switched off. Turn NFC on in Android settings, then try again.');

    return new Promise((resolve, reject) => {
      let stop = null;
      let done = false;

      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop?.();
        fn(value);
      };

      const timer = setTimeout(
        () => finish(reject, new Error('No tag detected. Hold the phone against the tag and try again.')),
        TAG_READ_TIMEOUT_MS,
      );

      listenForNfcTags((uid) => finish(resolve, String(uid).toUpperCase()))
        .then((cleanup) => {
          // The tag can be read before this resolves; tear down straight away if so.
          if (done) cleanup();
          else stop = cleanup;
        })
        .catch((err) => finish(reject, new Error(err?.message || 'NFC scan failed')));
    });
  }

  return new Promise((resolve, reject) => {
    if (!('NDEFReader' in window)) {
      reject(new Error('NFC not supported on this device'));
      return;
    }

    const reader = new window.NDEFReader();
    reader.scan()
      .then(() => {
        reader.onreadingerror = () => reject(new Error('Could not read NFC tag'));
        reader.onreading = (event) => {
          const uid = event.serialNumber || 'UNKNOWN';
          resolve(String(uid).toUpperCase());
        };
      })
      .catch((err) => reject(new Error(err.message || 'NFC scan failed')));
  });
}

export default function GuardPatrolConfig() {
  const { unbindDevice } = useAuth();
  const geo = useGeolocation();
  const [config, setConfig] = useState(getPatrolConfig());
  // The config as it last stood in the store — what a save or a clean load left behind.
  // Anything on screen that differs from this is the admin's unsaved work.
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(getPatrolConfig()));
  // A newer config arrived from the store while the admin was mid-edit. Held here instead of
  // being applied, and offered as a choice (see the banner) rather than taken silently.
  const [pendingRemoteConfig, setPendingRemoteConfig] = useState(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [locating, setLocating] = useState(null);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [showUnbind, setShowUnbind] = useState(false);
  const [unbindPassword, setUnbindPassword] = useState('');
  const [unbindLoading, setUnbindLoading] = useState(false);
  const [unbindError, setUnbindError] = useState('');
  // True while WE are saving, so the store-update event we trigger does not bounce
  // back and reload (clobbering the edits we just made — e.g. a fresh GPS pin).
  const selfSavingRef = useRef(false);
  // Derived, not tracked: whatever is on screen versus whatever was last saved.
  //
  // This is what stops a background sync from eating a schedule change. A full sync fires
  // `nightguard_patrol_config_updated` on its own timetable; this screen used to answer that by
  // reloading from the store, so a patrol time added seconds earlier vanished mid-edit with no
  // message. Nothing on a patrol screen is allowed to silently discard a supervisor's work.
  const hasUnsavedEdits = JSON.stringify(config) !== savedSnapshot;

  // Called after a save: the store now matches the screen, so nothing is pending or unsaved.
  const markSaved = (saved) => {
    setSavedSnapshot(JSON.stringify(saved));
    setPendingRemoteConfig(null);
  };

  // Mirrors hasUnsavedEdits for the store listener below, which is registered once and would
  // otherwise close over the value as it stood on mount — i.e. always "clean".
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = hasUnsavedEdits; }, [hasUnsavedEdits]);


  // Apply a config that came from the store rather than from the admin's fingers. Held back —
  // never applied — while there are unsaved edits on screen. Only ever called from effects.
  const applyRemoteConfig = (incoming) => {
    if (!incoming) return;
    if (dirtyRef.current) {
      setPendingRemoteConfig(incoming);
      return;
    }
    setConfig(incoming);
    setSavedSnapshot(JSON.stringify(incoming));
  };

  // Persist the given config without disturbing the on-screen editor. Used by the
  // auto-save actions (Set Location / Clear Location) so captured coordinates stick
  // immediately rather than only when the guard remembers to press Save.
  const persistConfig = async (nextConfig) => {
    selfSavingRef.current = true;
    try {
      const result = await savePatrolConfiguration(nextConfig, getCachedSiteSettings());
      // This writes the WHOLE on-screen config, so anything the admin had typed is now saved too.
      markSaved(nextConfig);
      return result;
    } catch (err) {
      setError(err.message || 'Failed to save patrol configuration');
      return null;
    } finally {
      selfSavingRef.current = false;
    }
  };

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const loaded = await loadPatrolConfiguration(getCachedSiteSettings());
        // Deliberately not setConfig: a slow first load must not land on top of edits the
        // admin has already started making.
        applyRemoteConfig(loaded);
      } catch (err) {
        setError(err.message || 'Failed to load patrol configuration');
      }
    };

    loadConfig();

    // Only reload from the store for updates that did NOT originate from this
    // screen. Our own saves already hold the authoritative state in React, and
    // reloading here would wipe in-progress edits.
    const handlePatrolUpdate = () => {
      if (selfSavingRef.current) return;
      applyRemoteConfig(getPatrolConfig());
    };
    window.addEventListener('nightguard_patrol_config_updated', handlePatrolUpdate);
    return () => window.removeEventListener('nightguard_patrol_config_updated', handlePatrolUpdate);
  }, []);

  const updateCheckpoint = (id, key, value) => {
    setConfig((prev) => ({
      ...prev,
      checkpoints: prev.checkpoints.map((checkpoint) => (
        checkpoint.id === id ? { ...checkpoint, [key]: value } : checkpoint
      )),
    }));
  };

  const addCheckpoint = () => {
    const newId = `cp-${Date.now()}`;
    setConfig((prev) => ({
      ...prev,
      checkpoints: [
        ...prev.checkpoints,
        {
          id: newId,
          name: '',
          tag_uid: '',
          zone: '',
          checkpoint_order: prev.checkpoints.length + 1,
          required: true,
          status: 'pending',
          latitude: null,
          longitude: null,
        },
      ],
    }));
    setSelectedCheckpointId(newId);
  };

  // Manual latitude/longitude entry. Keeps the raw string while typing so partial values
  // (e.g. "-26.") don't get coerced to NaN; save-time normalisation turns valid values into numbers.
  const setCheckpointCoord = (checkpointId, key, rawValue) => {
    updateCheckpoint(checkpointId, key, rawValue === '' ? null : rawValue);
  };

  const removeCheckpoint = (id) => {
    const scanCount = getNfcScans().filter((scan) => String(scan.checkpoint_id) === String(id)).length;
    if (scanCount > 0 && !window.confirm(`This checkpoint has ${scanCount} recorded scan${scanCount === 1 ? '' : 's'}. Deleting it will unlink those scans after sync. Continue?`)) {
      return;
    }

    setConfig((prev) => ({
      ...prev,
      checkpoints: prev.checkpoints.filter((checkpoint) => checkpoint.id !== id),
    }));
  };

  const addPatrolTime = () => {
    setConfig((prev) => ({
      ...prev,
      patrolTimes: [...(prev.patrolTimes || []), '06:00'],
    }));
  };

  const updatePatrolTime = (index, value) => {
    setConfig((prev) => ({
      ...prev,
      patrolTimes: (prev.patrolTimes || []).map((time, itemIndex) => (itemIndex === index ? value : time)),
    }));
  };

  const removePatrolTime = (index) => {
    setConfig((prev) => ({
      ...prev,
      patrolTimes: (prev.patrolTimes || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const validateConfig = () => {
    const errors = {};
    const times = Array.isArray(config.patrolTimes) ? config.patrolTimes : [];
    if (config.patrolScheduleEnabled !== false && times.length === 0) {
      errors.patrolTimes = 'Add at least one patrol time.';
    }
    times.forEach((time, index) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) {
        errors[`patrolTime_${index}`] = 'Use HH:mm format.';
      }
    });

    (config.checkpoints || []).forEach((checkpoint, index) => {
      const latEntered = checkpoint.latitude !== null && checkpoint.latitude !== undefined && String(checkpoint.latitude).trim() !== '';
      const lngEntered = checkpoint.longitude !== null && checkpoint.longitude !== undefined && String(checkpoint.longitude).trim() !== '';
      const hasCoordinates = isValidCoordinate(checkpoint.latitude, checkpoint.longitude);
      if (!checkpoint.name?.trim()) errors[`checkpoint_${checkpoint.id}_name`] = 'Name is required.';
      if ((latEntered || lngEntered) && !hasCoordinates) {
        errors[`checkpoint_${checkpoint.id}_tag_uid`] = 'GPS pin is invalid. Latitude -90..90, longitude -180..180.';
      } else if (!checkpoint.tag_uid?.trim() && !hasCoordinates) {
        errors[`checkpoint_${checkpoint.id}_tag_uid`] = 'Add an NFC tag or drop a GPS pin.';
      }
      if (!Number(checkpoint.checkpoint_order || index + 1)) errors[`checkpoint_${checkpoint.id}_checkpoint_order`] = 'Order is required.';
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleTapToLink = async (checkpointId) => {
    setScanning(checkpointId);
    setScanError(null);
    setError('');

    try {
      const uid = await readNfcTag();
      updateCheckpoint(checkpointId, 'tag_uid', uid);
    } catch (err) {
      setScanError(checkpointId);
      setError(`NFC error: ${err.message}`);
    } finally {
      setScanning(null);
    }
  };

  const handleSetLocation = async (checkpointId) => {
    setLocating(checkpointId);
    setError('');
    try {
      const fix = await geo.getCurrentPosition();
      const nextConfig = {
        ...config,
        checkpoints: config.checkpoints.map((checkpoint, index) => (
          checkpoint.id === checkpointId
            ? {
              ...checkpoint,
              // Auto-save rejects a nameless checkpoint; give it a sensible default so
              // dropping a pin never fails on a not-yet-named point. The admin can rename it.
              name: checkpoint.name?.trim() || `Checkpoint ${index + 1}`,
              latitude: Number(fix.latitude.toFixed(6)),
              longitude: Number(fix.longitude.toFixed(6)),
            }
            : checkpoint
        )),
      };
      setConfig(nextConfig);
      // Persist immediately so the captured pin survives store reloads / sync,
      // instead of living only in React state until the guard remembers to Save.
      await persistConfig(nextConfig);
    } catch (err) {
      setError(err.message || 'Unable to read GPS location.');
    } finally {
      setLocating(null);
    }
  };

  const clearLocation = (checkpointId) => {
    const nextConfig = {
      ...config,
      checkpoints: config.checkpoints.map((checkpoint) => (
        checkpoint.id === checkpointId
          ? { ...checkpoint, latitude: null, longitude: null }
          : checkpoint
      )),
    };
    setConfig(nextConfig);
    persistConfig(nextConfig);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    setValidationErrors({});

    // Our own save fires the store-update event; without this guard it bounces straight back
    // into applyRemoteConfig and raises a "changed on the server" banner against ourselves.
    selfSavingRef.current = true;
    try {
      if (!validateConfig()) {
        setError('Please fix the highlighted patrol configuration fields.');
        return;
      }
      const result = await savePatrolConfiguration(config, getCachedSiteSettings());
      if (config.patrolScheduleEnabled === false) {
        await NotificationService.cancelAllPatrolNotifications();
      } else {
        await NotificationService.scheduleAllDailyPatrols(config.patrolTimes || []);
      }
      // Saved: the store now holds what is on screen, so a reload is safe and any held
      // server version is stale — our save is the newer one.
      const stored = getPatrolConfig();
      setConfig(stored);
      markSaved(stored);
      setSuccess(result?._offline ? 'Patrol configuration saved locally and will sync later' : 'Patrol configuration saved');
    } catch (err) {
      setError(err.message || 'Failed to save patrol configuration');
    } finally {
      selfSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleUnbind = async (e) => {
    e.preventDefault();
    if (!unbindPassword.trim()) {
      setUnbindError('Password is required');
      return;
    }

    setUnbindLoading(true);
    setUnbindError('');
    try {
      await unbindDevice(unbindPassword);
    } catch (err) {
      setUnbindError(err.message || 'Incorrect password');
    } finally {
      setUnbindLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Guard Patrol Configuration</h1>
        <p style={{ margin: '6px 0 0', color: '#8b8b8b' }}>
          Configure patrol schedule enforcement, checkpoint count, and NFC tag mappings.
        </p>
      </div>

      {success && <div style={{ ...styles.card, borderColor: '#166534', color: '#86efac' }}>{success}</div>}
      {error && <div style={{ ...styles.card, borderColor: '#7f1d1d', color: '#fca5a5' }}>{error}</div>}

      {/* A sync brought a newer config while the admin was editing. Their work is still on
          screen and untouched; this is the only place the server version can win, and only
          because they pressed the button. */}
      {pendingRemoteConfig && (
        <div style={{ ...styles.card, borderColor: '#7f5310', background: '#2a1d05' }}>
          <div style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 6 }}>
            These patrol settings were changed elsewhere while you were editing
          </div>
          <div style={{ color: '#d4d4d4', fontSize: 13, marginBottom: 12 }}>
            Your changes are still here and have not been touched. Press <strong>Save Configuration</strong>{' '}
            to keep yours, or load the other version to discard yours.
          </div>
          <button
            type="button"
            style={styles.subtleBtn}
            onClick={() => {
              setConfig(pendingRemoteConfig);
              markSaved(pendingRemoteConfig);
            }}
          >
            Discard my changes and load theirs
          </button>
        </div>
      )}

      {hasUnsavedEdits && (
        <div style={{ ...styles.card, borderColor: '#334155', color: '#94a3b8', fontSize: 13 }}>
          You have unsaved changes. Nothing here is live until you press Save Configuration.
        </div>
      )}

      <div style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Schedule</h2>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label>
            <div style={{ color: '#a3a3a3', marginBottom: 6 }}>Patrol schedule toggle</div>
            <select
              style={styles.input}
              value={String(config.patrolScheduleEnabled)}
              onChange={(e) => setConfig({ ...config, patrolScheduleEnabled: e.target.value === 'true' })}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label>
            <div style={{ color: '#a3a3a3', marginBottom: 6 }}>Required NFC tags count</div>
            <input
              style={styles.input}
              type="number"
              min="1"
              value={config.minimumTagCount}
              onChange={(e) => setConfig({ ...config, minimumTagCount: Number(e.target.value) || 1 })}
            />
          </label>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Daily patrol times</h3>
            <button type="button" onClick={addPatrolTime} style={styles.subtleBtn}>+ Add Time</button>
          </div>
          {validationErrors.patrolTimes && <div style={styles.fieldError}>{validationErrors.patrolTimes}</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {(config.patrolTimes || []).map((time, index) => (
              <div key={`${time}-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ ...styles.input, maxWidth: 180 }}
                  type="time"
                  value={time}
                  onChange={(e) => updatePatrolTime(index, e.target.value)}
                />
                <button
                  type="button"
                  style={{ ...styles.subtleBtn, color: '#f87171', borderColor: '#7f1d1d' }}
                  onClick={() => removePatrolTime(index)}
                >
                  Remove
                </button>
                {validationErrors[`patrolTime_${index}`] && <div style={styles.fieldError}>{validationErrors[`patrolTime_${index}`]}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Patrol Checkpoints</h2>
            <p style={{ margin: '6px 0 0', color: '#8b8b8b', fontSize: 13 }}>
              Each checkpoint can use an NFC tag, a GPS location, or both. Tap "Link Tag" to bind an NFC tag,
              or "Set Location" while standing at the point to capture its GPS coordinates.
            </p>
          </div>
          <button onClick={addCheckpoint} style={styles.subtleBtn}>
            + Add Checkpoint
          </button>
        </div>

        {config.checkpoints.length > 0 && (() => {
          const activeId = selectedCheckpointId && config.checkpoints.some((cp) => cp.id === selectedCheckpointId)
            ? selectedCheckpointId
            : config.checkpoints[0].id;
          const active = config.checkpoints.find((cp) => cp.id === activeId) || null;
          const activeIndex = config.checkpoints.findIndex((cp) => cp.id === activeId);
          const activeHasLocation = active && Number.isFinite(Number(active.latitude)) && Number.isFinite(Number(active.longitude));
          const activeLocating = locating === activeId;

          return (
            <div style={{ marginTop: 16, border: '1px solid #1f2937', background: '#0b1220', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Drop patrol point pins</h3>
              </div>
              <p style={{ margin: '0 0 12px', color: '#8b8b8b', fontSize: 13 }}>
                Pick a patrol point, then drop its pin using your current GPS location or by entering coordinates.
                Pins are used to auto check-in guards when they reach each point.
              </p>

              <label style={{ display: 'block', color: '#a3a3a3', fontSize: 13, marginBottom: 6 }}>Patrol point</label>
              <select
                style={styles.input}
                value={activeId}
                onChange={(e) => setSelectedCheckpointId(e.target.value)}
              >
                {config.checkpoints.map((cp, index) => {
                  const pinned = Number.isFinite(Number(cp.latitude)) && Number.isFinite(Number(cp.longitude));
                  return (
                    <option key={cp.id} value={cp.id}>
                      {`${index + 1}. ${cp.name?.trim() || 'Unnamed point'}`}{pinned ? '  — pinned' : '  — no pin'}
                    </option>
                  );
                })}
              </select>

              {active && (
                <>
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 12 }}>
                    <label>
                      <div style={{ color: '#a3a3a3', fontSize: 12, marginBottom: 4 }}>Latitude</div>
                      <input
                        style={{ ...styles.input, fontFamily: 'monospace', fontSize: 13 }}
                        value={active.latitude ?? ''}
                        onChange={(e) => setCheckpointCoord(activeId, 'latitude', e.target.value.trim())}
                        placeholder="-26.204103"
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      <div style={{ color: '#a3a3a3', fontSize: 12, marginBottom: 4 }}>Longitude</div>
                      <input
                        style={{ ...styles.input, fontFamily: 'monospace', fontSize: 13 }}
                        value={active.longitude ?? ''}
                        onChange={(e) => setCheckpointCoord(activeId, 'longitude', e.target.value.trim())}
                        placeholder="28.047305"
                        inputMode="decimal"
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button
                      style={activeLocating ? styles.nfcBtnActive : styles.nfcBtn}
                      onClick={() => !activeLocating && handleSetLocation(activeId)}
                      disabled={activeLocating}
                      title="Stand at the point and drop a pin at your current GPS location"
                    >
                      {activeLocating ? 'Reading GPS...' : activeHasLocation ? 'Re-drop Pin (My Location)' : 'Drop Pin (My Location)'}
                    </button>
                    {activeHasLocation && (
                      <button
                        style={{ ...styles.subtleBtn, color: '#f87171', borderColor: '#7f1d1d' }}
                        onClick={() => clearLocation(activeId)}
                      >
                        Clear Pin
                      </button>
                    )}
                    <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: activeHasLocation ? '#86efac' : '#8b8b8b' }}>
                      {activeHasLocation
                        ? `Pin ${activeIndex + 1} set`
                        : 'No pin dropped for this point yet'}
                    </span>
                  </div>
                </>
              )}

              <div style={{ marginTop: 16 }}>
                <CheckpointMap
                  checkpoints={config.checkpoints}
                  selectedId={activeId}
                  onSelect={(id) => setSelectedCheckpointId(id)}
                />
              </div>
            </div>
          );
        })()}

        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          {config.checkpoints.map((checkpoint) => {
            const isScanning = scanning === checkpoint.id;
            const hasTagLinked = Boolean(checkpoint.tag_uid?.trim());
            const isLocating = locating === checkpoint.id;
            const hasLocation = Number.isFinite(Number(checkpoint.latitude)) && Number.isFinite(Number(checkpoint.longitude));

            return (
              <div key={checkpoint.id} style={{ border: `1px solid ${isScanning ? '#166534' : '#1f1f1f'}`, borderRadius: 12, padding: 14, background: '#111' }}>
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                  <input
                    style={styles.input}
                    value={checkpoint.name}
                    onChange={(e) => updateCheckpoint(checkpoint.id, 'name', e.target.value)}
                    placeholder="Checkpoint name"
                  />
                  <input
                    style={styles.input}
                    value={checkpoint.zone}
                    onChange={(e) => updateCheckpoint(checkpoint.id, 'zone', e.target.value)}
                    placeholder="Zone"
                  />
                  <input
                    style={styles.input}
                    type="number"
                    min="1"
                    value={checkpoint.checkpoint_order || ''}
                    onChange={(e) => updateCheckpoint(checkpoint.id, 'checkpoint_order', Number(e.target.value) || 1)}
                    placeholder="Order"
                  />
                </div>
                <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                  {validationErrors[`checkpoint_${checkpoint.id}_name`] && <div style={styles.fieldError}>{validationErrors[`checkpoint_${checkpoint.id}_name`]}</div>}
                  <div />
                  {validationErrors[`checkpoint_${checkpoint.id}_checkpoint_order`] && <div style={styles.fieldError}>{validationErrors[`checkpoint_${checkpoint.id}_checkpoint_order`]}</div>}
                </div>

                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <input
                      style={{
                        ...styles.input,
                        borderColor: hasTagLinked ? '#166534' : '#2a2a2a',
                        color: hasTagLinked ? '#86efac' : '#fff',
                        fontFamily: 'monospace',
                        fontSize: 13,
                      }}
                      value={checkpoint.tag_uid}
                      onChange={(e) => updateCheckpoint(checkpoint.id, 'tag_uid', e.target.value.toUpperCase())}
                      placeholder="NFC tag UID"
                    />
                    {validationErrors[`checkpoint_${checkpoint.id}_tag_uid`] && (
                      <div style={styles.fieldError}>{validationErrors[`checkpoint_${checkpoint.id}_tag_uid`]}</div>
                    )}
                  </div>

                  <button
                    style={isScanning ? styles.nfcBtnActive : styles.nfcBtn}
                    onClick={() => !isScanning && handleTapToLink(checkpoint.id)}
                    disabled={isScanning}
                    title={isScanning ? 'Hold NFC tag against device' : 'Tap to read NFC tag UID'}
                  >
                    {isScanning ? 'Hold tag to device...' : hasTagLinked ? 'Re-link Tag' : 'Link Tag'}
                  </button>

                  <button
                    style={{ ...styles.subtleBtn, color: '#f87171', borderColor: '#7f1d1d' }}
                    onClick={() => removeCheckpoint(checkpoint.id)}
                  >
                    Remove
                  </button>
                </div>

                {scanError === checkpoint.id && (
                  <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>
                    NFC read failed. Make sure NFC is enabled and try again.
                  </div>
                )}

                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <input
                      style={{
                        ...styles.input,
                        borderColor: hasLocation ? '#166534' : '#2a2a2a',
                        color: hasLocation ? '#86efac' : '#fff',
                        fontFamily: 'monospace',
                        fontSize: 13,
                      }}
                      value={hasLocation ? `${Number(checkpoint.latitude).toFixed(6)}, ${Number(checkpoint.longitude).toFixed(6)}` : ''}
                      readOnly
                      placeholder="GPS location not set"
                    />
                  </div>

                  <button
                    style={isLocating ? styles.nfcBtnActive : styles.nfcBtn}
                    onClick={() => !isLocating && handleSetLocation(checkpoint.id)}
                    disabled={isLocating}
                    title="Stand at the checkpoint and capture its GPS coordinates"
                  >
                    {isLocating ? 'Reading GPS...' : hasLocation ? 'Update Location' : 'Set Location'}
                  </button>

                  {hasLocation && (
                    <button
                      style={{ ...styles.subtleBtn, color: '#f87171', borderColor: '#7f1d1d' }}
                      onClick={() => clearLocation(checkpoint.id)}
                    >
                      Clear GPS
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ ...styles.button, padding: '12px 18px', borderRadius: 12, fontWeight: 700, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>

      <div style={{ ...styles.dangerCard, marginTop: 32 }}>
        <h2 style={{ marginTop: 0, color: '#f87171' }}>Danger Zone</h2>
        <p style={{ color: '#8b8b8b', margin: '0 0 16px', fontSize: 14 }}>
          Unbinding removes all local credentials and shift sessions from this device. The device will return to the login screen.
        </p>

        {!showUnbind ? (
          <button
            style={{ ...styles.subtleBtn, color: '#f87171', borderColor: '#7f1d1d' }}
            onClick={() => {
              setShowUnbind(true);
              setUnbindError('');
            }}
          >
            Unbind this device
          </button>
        ) : (
          <form onSubmit={handleUnbind} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
            <p style={{ margin: 0, color: '#fca5a5', fontSize: 13 }}>
              Enter your admin password to confirm. This cannot be undone without re-logging in.
            </p>
            <input
              style={styles.input}
              type="password"
              value={unbindPassword}
              onChange={(e) => setUnbindPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
            />
            {unbindError && <div style={{ color: '#f87171', fontSize: 13 }}>{unbindError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="submit"
                disabled={unbindLoading}
                style={{ ...styles.button, opacity: unbindLoading ? 0.6 : 1 }}
              >
                {unbindLoading ? 'Verifying...' : 'Confirm Unbind'}
              </button>
              <button
                type="button"
                style={styles.subtleBtn}
                onClick={() => {
                  setShowUnbind(false);
                  setUnbindPassword('');
                  setUnbindError('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
