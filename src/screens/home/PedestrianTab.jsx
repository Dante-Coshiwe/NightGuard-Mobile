import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './home-styles.css';
import { useOfflineApi } from '../../hooks/useOfflineApi';
import { useScrollIntoView } from '../../hooks/useScrollIntoView';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../../lib/connectivity';
import {
  getCachedPedestrians,
  getCachedSiteSettings,
  getLookupData,
  getPreclearedPedestrians,
  getShiftSession,
  saveCachedPedestrians,
  updateCachedPedestrian,
} from '../../lib/deviceStore';
import { useAuth } from '../../contexts/AuthContext';
import { buildPendingPhoto, normaliseSelectedPhoto, uploadEntryPhoto } from '../../lib/photoCapture';
import {
  clearEntryDraft,
  entryDraftHasContent,
  flushEntryDraft,
  installEntryDraftFlush,
  loadEntryDraft,
  saveEntryDraft,
} from '../../lib/entryDraft';
import { holdLiveUpdates } from '../../services/liveUpdate';
import { getBoundSiteIdSync } from '../../lib/siteResolver';

export default function PedestrianTab() {
  const { user, shiftSession } = useAuth();
  const [lookupData, setLookupData] = useState(getLookupData());
  const [pedestrians, setPedestrians] = useState([]);
  const [precleared, setPrecleared] = useState(getPreclearedPedestrians());
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('all');
  const { post, patch, isOnline } = useOfflineApi();
  const onFocus = useScrollIntoView();
  const suppressCacheEvent = React.useRef(false);
  const [name, setName] = useState('');
  const [visitorType, setVisitorType] = useState(lookupData.pedestrianTypes[0] || 'Visitor');
  const [unitVisiting, setUnitVisiting] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [error, setError] = useState('');
  // An unfinished registration recovered from disk, offered back rather than silently
  // reinstated — see lib/entryDraft.js for everything that can destroy this form mid-write.
  const [recoveredDraft, setRecoveredDraft] = useState(null);

  const PedestrianThumbnail = ({ photoUrl, label }) => (
    <div className="entry-thumbnail" aria-label={`${label || 'Pedestrian'} photo`}>
      {photoUrl ? (
        <img src={photoUrl} alt="" loading="lazy" />
      ) : (
        <svg viewBox="0 0 40 40" role="img" aria-hidden="true">
          <circle cx="20" cy="14" r="7" fill="#6b7280" />
          <path d="M9 34c1.4-8 7-12 11-12s9.6 4 11 12" fill="#6b7280" />
        </svg>
      )}
    </div>
  );

  const mergeWithCachedPendingExits = (serverData, cachedData) => {
    const cachedById = new Map(cachedData.map((entry) => [String(entry.id), entry]));

    const mergedServerRows = serverData.map((entry) => {
      const cached = cachedById.get(String(entry.id));
      if (!cached) return entry;
      if ((cached._pendingExit || cached.hasLeft) && !entry.hasLeft) {
        return {
          ...entry,
          hasLeft: true,
          exitTime: cached.exitTime || new Date().toISOString(),
          _offline: true,
          _pendingExit: true,
        };
      }
      return { ...entry, _offline: false, _pendingExit: false };
    });

    // ✅ Keep ALL cached entries not yet on server — includes temp IDs and
    // recently confirmed entries that the server fetch may not have returned yet.
    // Do NOT filter by _offline flag — a just-confirmed entry has _offline:false
    // but a temp ID like "veh_..." that the server doesn't know about yet.
    const offlinePending = cachedData.filter((entry) =>
      !serverData.some((s) => String(s.id) === String(entry.id))
    );

    return [...mergedServerRows, ...offlinePending];
  };

  useEffect(() => {
    const handleLookupUpdate = () => {
      const next = getLookupData();
      setLookupData(next);
      setVisitorType((current) =>
        next.pedestrianTypes.includes(current) ? current : next.pedestrianTypes[0] || 'Visitor'
      );
    };
    window.addEventListener('nightguard_lookup_updated', handleLookupUpdate);
    return () => window.removeEventListener('nightguard_lookup_updated', handleLookupUpdate);
  }, []);

  // A reclaimed app comes back with showForm false — every bit of React state is gone — so the
  // recovered draft is offered on the LIST, which is where the guard actually lands.
  useEffect(() => {
    let cancelled = false;
    loadEntryDraft('pedestrian').then((draft) => {
      if (!cancelled && entryDraftHasContent(draft)) setRecoveredDraft(draft);
    }).catch(() => null);
    const uninstall = installEntryDraftFlush('pedestrian');
    return () => { cancelled = true; uninstall(); };
  }, []);

  // Stop anything reloading the app while the form is open. This covers what idle time cannot:
  // a guard standing in the camera for two minutes looks perfectly idle from inside the updater.
  useEffect(() => {
    if (!showForm) return undefined;
    return holdLiveUpdates('pedestrian-entry-form');
  }, [showForm]);

  // Persist as it is filled. Debounced inside, and forced out the moment the app loses the
  // foreground — which is exactly when the camera opens.
  useEffect(() => {
    if (!showForm) return;
    saveEntryDraft('pedestrian', {
      fields: { name, visitorType, unitVisiting },
      photo: photoFile,
    });
  }, [showForm, name, visitorType, unitVisiting, photoFile]);

  useEffect(() => {
    const loadPedestrians = async () => {
      const cached = getCachedPedestrians();
      // NightGuard fix: hydrate cache before any network work so the tab renders instantly offline.
      setPedestrians(cached);
      setLoading(false);

      if (!navigator.onLine) return;

      // ✅ Always show cache immediately — guard never sees a blank screen
      const freshCached = getCachedPedestrians();
      if (freshCached.length > 0) {
        setPedestrians(freshCached);
      }

      try {
        const response = await api.get('/pedestrians/recent');
        const serverData = response.data.map((p) => ({
          id: p.id,
          name: p.full_name,
          contact: p.contact_number,
          visitorType: p.purpose_of_visit,
          unitVisiting: p.visiting_unit,
          hostName: p.host_name,
          photoUrl: p.picture_url,
          entryTime: p.entry_time,
          exitTime: p.exit_time,
          hasLeft: !!p.exit_time,
          isPrecleared: Boolean(p.is_precleared),
        }));

        const merged = mergeWithCachedPendingExits(serverData, getCachedPedestrians());
        setPedestrians(merged);
        saveCachedPedestrians(merged);
      } catch {
        // Already showing cache above — no extra action needed
        // NightGuard fix: cache is truth; remote refresh failures stay silent for guards.
      }
    };

    loadPedestrians();

    const handleSync = () => loadPedestrians();
    const handleCacheUpdate = () => {
      if (suppressCacheEvent.current) return;
      setPedestrians(getCachedPedestrians());
    };
    const handleOnline = () => {
      console.log('[PedestrianTab] Coming online - reloading pedestrians from server');
      loadPedestrians();
    };
    window.addEventListener('nightguard_sync_complete', handleSync);
    window.addEventListener('nightguard_pedestrians_updated', handleCacheUpdate);
    window.addEventListener('online', handleOnline);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    return () => {
      window.removeEventListener('nightguard_sync_complete', handleSync);
      window.removeEventListener('nightguard_pedestrians_updated', handleCacheUpdate);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, []);

  useEffect(() => {
    // NightGuard fix: debounce list filtering on slower guard devices.
    const timer = setTimeout(() => setSearch(searchInput), 150);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleMarkExit = async (id) => {
    const isTempId =
      String(id).startsWith('offline_') ||
      String(id).startsWith('temp_') ||
      String(id).startsWith('ped_');
    const exitTime = new Date().toISOString();

    // ✅ Optimistic UI — guard sees exit immediately
    setPedestrians((prev) =>
      prev.map((p) =>
        String(p.id) === String(id)
          ? { ...p, hasLeft: true, exitTime, _offline: true, _pendingExit: true }
          : p
      )
    );

    try {
      const result = await patch(`/pedestrians/${id}/exit`, {}, {
        clientTempId: `ped_exit_${id}`,
        offlineResponse: { exit_time: exitTime, _offline: true },
        forceQueue: isTempId,
      });

      const finalExitTime = result?.exit_time || exitTime;
      const isOffline = Boolean(result?._offline);

      suppressCacheEvent.current = true;
      updateCachedPedestrian(id, {
        hasLeft: true,
        exitTime: finalExitTime,
        _offline: isOffline,
        _pendingExit: isOffline,
      });
      setPedestrians((prev) =>
        prev.map((p) =>
          String(p.id) === String(id)
            ? { ...p, hasLeft: true, exitTime: finalExitTime, _offline: isOffline, _pendingExit: isOffline }
            : p
        )
      );
      suppressCacheEvent.current = false;
    } catch {
      suppressCacheEvent.current = true;
      updateCachedPedestrian(id, {
        hasLeft: true,
        exitTime,
        _offline: true,
        _pendingExit: true,
      });
      suppressCacheEvent.current = false;
    }
  };

  const validateForm = () => {
    const errors = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (!unitVisiting.trim()) errors.unitVisiting = 'Unit visiting is required';
    if (!visitorType) errors.visitorType = 'Visitor type is required';
    if (!photoFile && !photo) errors.photo = 'A photo is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    normaliseSelectedPhoto(file).then((selectedPhoto) => {
      setPhotoFile(selectedPhoto);
      setPhoto(selectedPhoto.dataUrl);
    }).catch(() => setError('Could not load the selected photo'));
  };

  // ⚠ CRUCIAL — same exposure as VehicleTab, see the longer note there. Opening the picker
  // backgrounds the app and a low-RAM handset routinely gets reclaimed behind it; a photo is
  // REQUIRED to submit, so every pedestrian entry passes through this moment.
  //
  // Both mechanisms are wired up above — holdLiveUpdates() while the form is open, and a
  // filesystem draft (lib/entryDraft.js). The flush is forced here as well rather than relying on
  // the visibilitychange listener alone: this is the one call site that knows for certain the app
  // is about to leave.
  const openPhotoPicker = (inputId) => {
    saveEntryDraft('pedestrian', {
      fields: { name, visitorType, unitVisiting },
      photo: photoFile,
    });
    void flushEntryDraft('pedestrian');
    document.getElementById(inputId)?.click();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setError('');
    setSubmitting(true);

    const tempId = `ped_${Date.now()}`;
    // The DEVICE's bound site — the same authority every read filters on. See the longer note in
    // VehicleTab.handleSubmit: cached site settings are a different source with a different
    // precedence, and they lag the binding after a dashboard relocation.
    const siteId = getBoundSiteIdSync() || getCachedSiteSettings().id || null;
    // Stamp the arrival now, not when the row reaches the server. createPedestrian() falls back to
    // now() when entry_time is absent, so an entry registered offline used to be recorded at the
    // moment the queue happened to drain -- minutes or hours after the person actually arrived.
    const entryTime = new Date().toISOString();
    let pictureUrl = null;
    try {
      pictureUrl = navigator.onLine && photoFile
        ? await uploadEntryPhoto({ photo: photoFile, type: 'pedestrians', tempId, siteId })
        : null;
    } catch (err) {
      console.warn('[PedestrianTab] Photo upload failed, continuing without photo:', err.message);
      pictureUrl = null; // continue without photo
    }

    // Offline (or a failed online upload): carry the photo through the offline queue so it
    // uploads on sync. Without this the picture is lost the moment the entry syncs.
    const pendingPhoto = !pictureUrl ? buildPendingPhoto(photoFile) : null;

    const payload = {
      site_id: siteId,
      shift_id: shiftSession?.id || getShiftSession()?.id || null,
      guard_id: user?.id || null,
      full_name: name,
      contact_number: null,
      visiting_unit: unitVisiting,
      host_name: '',
      purpose_of_visit: visitorType,
      is_precleared: false,
      entry_time: entryTime,
      picture_url: pictureUrl,
      ...(pendingPhoto ? { _pendingPhoto: pendingPhoto } : {}),
    };

    // ✅ Build local entry FIRST — before any async call
    const localEntry = {
      id: tempId,
      name: payload.full_name,
      contact: payload.contact_number,
      visitorType: payload.purpose_of_visit,
      unitVisiting: payload.visiting_unit,
      hostName: payload.host_name,
      photoUrl: pictureUrl || photo || '',
      entryTime,
      exitTime: null,
      hasLeft: false,
      isPrecleared: false,
      _offline: true,       // assume offline until server confirms
      _pendingExit: false,
    };

    // ✅ Write to cache and show in UI immediately — guard sees it right now
    // Step 1: Write to cache FIRST — this survives page switches
    const existingPeds = getCachedPedestrians();
    const dedupedWithNew = [localEntry, ...existingPeds.filter(p => String(p.id) !== String(tempId))];
    saveCachedPedestrians(dedupedWithNew);

    // Step 2: Update UI state directly
    suppressCacheEvent.current = true;
    setPedestrians((prev) => [localEntry, ...prev.filter(p => String(p.id) !== String(tempId))]);
    setTimeout(() => { suppressCacheEvent.current = false; }, 50);

    // Step 3: Reset form and close.
    // The draft goes only now, after the entry is in the cache above (step 1) and therefore
    // durable. Clearing it any earlier would open a window where the work exists nowhere.
    void clearEntryDraft('pedestrian');
    setRecoveredDraft(null);
    setName('');
    setVisitorType(lookupData.pedestrianTypes[0] || 'Visitor');
    setUnitVisiting('');
    setPhoto(null);
    setPhotoFile(null);
    setShowForm(false);
    setFormErrors({});
    setSubmitting(false);

    // Step 4: Attempt API in background — swap temp ID for real ID if server responds
    try {
      const response = await post('/pedestrians/entry', payload, {
        clientTempId: tempId,
        // A photo still waiting to upload only ever uploads on a queue drain. Posting straight to
        // the server instead saves the entry and drops _pendingPhoto on the floor — createPedestrian
        // strips it as a non-column — so the picture is lost with no error anywhere. That happens
        // whenever the storage write above failed while the database itself was reachable.
        forceQueue: Boolean(pendingPhoto),
      });

      if (response && !response._offline && response.id) {
        const confirmedEntry = {
          ...localEntry,
          id: response.id,
          entryTime: response.entry_time || localEntry.entryTime,
          _offline: false,
        };
        const currentPeds = getCachedPedestrians();
        saveCachedPedestrians([confirmedEntry, ...currentPeds.filter(p => String(p.id) !== String(tempId))]);
        suppressCacheEvent.current = true;
        setPedestrians((prev) => [confirmedEntry, ...prev.filter(p => String(p.id) !== String(tempId))]);
        setTimeout(() => { suppressCacheEvent.current = false; }, 50);
      }
    } catch (err) {
      console.warn('[PedestrianTab] Background post failed, entry remains in offline queue:', err.message);
    }
  };

  const visiblePedestrians = useMemo(() => {
    // NightGuard fix: memoize expensive list filtering and debounce search input upstream.
    return pedestrians.filter((p) => {
      const normalisedSearch = search.toLowerCase();
      const matchesSearch =
        p.name?.toLowerCase().includes(normalisedSearch) ||
        p.contact?.includes(search) ||
        p.unitVisiting?.toLowerCase().includes(normalisedSearch);
      const matchesView =
        activeView === 'all' ||
        (activeView === 'precleared' ? p.isPrecleared : p.visitorType === activeView);
      return matchesSearch && matchesView;
    });
  }, [pedestrians, search, activeView]);

  const inside = visiblePedestrians.filter((p) => !p.hasLeft).length;

  if (showForm) {
    return (
      <div className="tab-content">
        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title">Register Pedestrian</h2>
            {/* Closing the form is a decision to abandon the registration, so the draft goes with
                it. An Android reclaim is NOT a decision, which is why that case keeps the draft. */}
            <button
              className="close-button"
              onClick={() => {
                setShowForm(false);
                setFormErrors({});
                setError('');
                setName('');
                setUnitVisiting('');
                setPhoto(null);
                setPhotoFile(null);
                void clearEntryDraft('pedestrian');
                setRecoveredDraft(null);
              }}
            >
              x
            </button>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label required">Full Name</label>
              {/* NightGuard fix: focused field scrolls itself into view without keyboard inset changes. */}
              <input className={`form-input ${formErrors.name ? 'error' : ''}`} value={name} onFocus={onFocus} onChange={(e) => setName(e.target.value)} disabled={submitting} />
              {formErrors.name && <div className="form-error">{formErrors.name}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Visitor Type</label>
              <select className={`form-select ${formErrors.visitorType ? 'error' : ''}`} value={visitorType} onFocus={onFocus} onChange={(e) => setVisitorType(e.target.value)} disabled={submitting}>
                {lookupData.pedestrianTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
              {formErrors.visitorType && <div className="form-error">{formErrors.visitorType}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Unit Visiting</label>
              <input className={`form-input ${formErrors.unitVisiting ? 'error' : ''}`} list="pedestrian-units" value={unitVisiting} onFocus={onFocus} onChange={(e) => setUnitVisiting(e.target.value)} disabled={submitting} />
              <datalist id="pedestrian-units">
                {lookupData.units.map((unit) => <option key={unit} value={unit} />)}
              </datalist>
              {formErrors.unitVisiting && <div className="form-error">{formErrors.unitVisiting}</div>}
            </div>
            {/* NightGuard fix: photo is required for fast visual verification at the gate. */}
            <div className="photo-section">
              {photo ? (
                <img src={photo} alt="Pedestrian preview" className="photo-preview" />
              ) : (
                <p className="photo-placeholder">No photo taken</p>
              )}
              <div className="photo-buttons">
                <button className="photo-button" type="button" onClick={() => openPhotoPicker('home-pedestrian-camera')} disabled={submitting}>
                  Camera
                </button>
                <label className="photo-button browser-photo-button">
                  <input
                    id="home-pedestrian-camera"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onFocus={onFocus}
                    onChange={handlePhotoSelect}
                    style={{ display: 'none' }}
                    disabled={submitting}
                  />
                </label>
                <button className="photo-button" type="button" onClick={() => openPhotoPicker('home-pedestrian-gallery')} disabled={submitting}>
                  Gallery
                </button>
                <label className="photo-button browser-photo-button">
                  <input
                    id="home-pedestrian-gallery"
                    type="file"
                    accept="image/*"
                    onFocus={onFocus}
                    onChange={handlePhotoSelect}
                    style={{ display: 'none' }}
                    disabled={submitting}
                  />
                </label>
              </div>
              {formErrors.photo && <div className="form-error">{formErrors.photo}</div>}
            </div>
            <div className="button-group" style={{ marginTop: '24px' }}>
              <button type="submit" className="button-add" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Registration'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      {/* The app was taken away mid-registration — almost always by the camera intent. Offered
          back rather than reinstated silently, so the guard is told what happened. */}
      {recoveredDraft && !showForm && (
        <div className="entry-draft-banner">
          <div className="entry-draft-text">
            <strong>Unfinished pedestrian registration</strong>
            <span>
              {recoveredDraft.fields?.name ? `${recoveredDraft.fields.name} — ` : ''}
              saved {new Date(recoveredDraft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {recoveredDraft.photoDropped ? ' (photo not recovered)' : ''}
            </span>
          </div>
          <div className="entry-draft-actions">
            <button
              className="entry-draft-resume"
              onClick={() => {
                const fields = recoveredDraft.fields || {};
                setName(fields.name || '');
                setUnitVisiting(fields.unitVisiting || '');
                setVisitorType(fields.visitorType || lookupData.pedestrianTypes[0] || 'Visitor');
                setPhotoFile(recoveredDraft.photo || null);
                setPhoto(recoveredDraft.photo?.dataUrl || null);
                setRecoveredDraft(null);
                setShowForm(true);
              }}
            >
              Resume
            </button>
            <button
              className="entry-draft-discard"
              onClick={() => { void clearEntryDraft('pedestrian'); setRecoveredDraft(null); }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="panel-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
            Pedestrians <span style={{ color: '#f87171', fontSize: 13 }}>({inside} inside)</span>
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* NightGuard fix: small offline cue without interrupting the guard's workflow. */}
            {!isOnline && <span className="offline-dot-label"><span />Offline</span>}
            <button className="button-add compact" onClick={() => setShowForm(true)}>+ Add</button>
          </div>
        </div>

        <div className="chip-row">
          <button className={`filter-chip ${activeView === 'all' ? 'active' : ''}`} onClick={() => setActiveView('all')}>All</button>
          <button className={`filter-chip ${activeView === 'precleared' ? 'active' : ''}`} onClick={() => setActiveView('precleared')}>Pre-cleared</button>
          {lookupData.pedestrianTypes.map((type) => (
            <button key={type} className={`filter-chip ${activeView === type ? 'active' : ''}`} onClick={() => setActiveView(type)}>
              {type}
            </button>
          ))}
        </div>
      </div>

      {precleared.length > 0 && (
        <div className="panel-card">
          <div className="section-heading">Pre-cleared visitors</div>
          <div className="list-container">
            {precleared.slice(0, 4).map((entry) => (
              <div key={entry.id} className="list-item slim">
                <div className="list-item-header">
                  <div className="list-item-title">{entry.name}</div>
                  <div className="list-item-badge">{entry.visitorType}</div>
                </div>
                <div className="list-item-meta">{entry.unitVisiting} • {entry.hostName || 'No host set'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        type="text"
        placeholder="Search by name or unit..."
        value={searchInput}
        onFocus={onFocus}
        onChange={(e) => setSearchInput(e.target.value)}
        className="form-input"
        style={{ marginBottom: 12 }}
      />

      {visiblePedestrians.length === 0 ? (
        <div className="list-empty"><p>No pedestrians found</p></div>
      ) : (
        <div className="list-container">
          {visiblePedestrians.map((ped) => (
            <div key={ped.id} className="list-item" style={{ opacity: ped.hasLeft ? 0.55 : 1, borderLeft: ped.hasLeft ? '3px solid #22c55e' : '3px solid #dc2626' }}>
              <div className="list-item-header">
                {/* NightGuard fix: fixed thumbnail space prevents list-card layout shifts. */}
                <div className="entry-title-row">
                  <PedestrianThumbnail photoUrl={ped.photoUrl} label={ped.name} />
                  <div className="list-item-title">
                    {ped.name}
                    {ped._offline && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 6, fontWeight: 400, letterSpacing: 0.2 }}>offline</span>}
                  </div>
                </div>
                {!ped.hasLeft ? (
                  <button onClick={() => handleMarkExit(ped.id)} className="list-action-button">Exit</button>
                ) : (
                  <span style={{ fontSize: 12, color: '#22c55e' }}>Left</span>
                )}
              </div>
              <div className="meta-row">
                <span className="list-item-badge">{ped.visitorType || 'Unknown'}</span>
                {ped.isPrecleared && <span className="soft-badge">Pre-cleared</span>}
              </div>
              <div className="list-item-meta">Unit: {ped.unitVisiting || '-'} • Host: {ped.hostName || '-'}</div>
              <div className="list-item-meta">Entry: {ped.entryTime ? new Date(ped.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</div>
              {ped.hasLeft && <div className="list-item-meta">Exit: {ped.exitTime ? new Date(ped.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
