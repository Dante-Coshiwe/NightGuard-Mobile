import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './home-styles.css';
import { useOfflineApi } from '../../hooks/useOfflineApi';
import { useScrollIntoView } from '../../hooks/useScrollIntoView';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../../lib/connectivity';
import {
  getBlacklistedVehicles,
  getCachedSiteSettings,
  getCachedVehicles,
  getLookupData,
  getShiftSession,
  removeBlacklistedVehicle,
  saveCachedVehicles,
  updateCachedVehicle,
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

export default function VehicleTab() {
  const { user, shiftSession } = useAuth();
  const [lookupData, setLookupData] = useState(getLookupData());
  const [vehicles, setVehicles] = useState([]);
  const [blacklistedVehicles, setBlacklistedVehicles] = useState(getBlacklistedVehicles());
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [personVisiting, setPersonVisiting] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [visitorType, setVisitorType] = useState(lookupData.vehicleTypes[0] || 'Visitor');
  const [vehicleErrors, setVehicleErrors] = useState({});
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('all');
  // An unfinished registration recovered from disk, offered back rather than silently
  // reinstated — see lib/entryDraft.js for everything that can destroy this form mid-write.
  const [recoveredDraft, setRecoveredDraft] = useState(null);
  const { post, patch, isOnline } = useOfflineApi();
  const onFocus = useScrollIntoView();
  // Prevents nightguard_vehicles_updated event from overwriting a state update
  // we just made directly (e.g. from handleSubmit or handleMarkExit).
  const suppressCacheEvent = React.useRef(false);

  // `pending` is a photo captured but not yet uploaded. Its bytes deliberately live in the
  // offline queue and nowhere else, so there is nothing to render yet — say it is coming
  // rather than showing the same blank icon as an entry that has no photo at all.
  const VehicleThumbnail = ({ photoUrl, label, pending }) => (
    <div className="entry-thumbnail" aria-label={`${label || 'Vehicle'} photo`}>
      {photoUrl ? (
        <img src={photoUrl} alt="" loading="lazy" />
      ) : pending ? (
        <svg viewBox="0 0 40 40" role="img" aria-label="Photo waiting to upload">
          <rect x="8" y="16" width="24" height="10" rx="3" fill="#4b5563" />
          <path d="M12 16l3-5h10l3 5" fill="none" stroke="#4b5563" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="31" cy="31" r="7" fill="#f59e0b" />
          <path d="M31 27.5v4l2.5 1.5" stroke="#1f2937" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 40 40" role="img" aria-hidden="true">
          <rect x="8" y="16" width="24" height="10" rx="3" fill="#6b7280" />
          <path d="M12 16l3-5h10l3 5" fill="none" stroke="#6b7280" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="14" cy="28" r="3" fill="#9ca3af" />
          <circle cx="26" cy="28" r="3" fill="#9ca3af" />
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
          exitedAt: cached.exitedAt || new Date().toISOString(),
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
        next.vehicleTypes.includes(current) ? current : next.vehicleTypes[0] || 'Visitor'
      );
    };
    window.addEventListener('nightguard_lookup_updated', handleLookupUpdate);
    return () => window.removeEventListener('nightguard_lookup_updated', handleLookupUpdate);
  }, []);

  // A reclaimed app comes back with showForm false — every bit of React state is gone — so the
  // recovered draft is offered on the LIST, which is where the guard actually lands.
  useEffect(() => {
    let cancelled = false;
    loadEntryDraft('vehicle').then((draft) => {
      if (!cancelled && entryDraftHasContent(draft)) setRecoveredDraft(draft);
    }).catch(() => null);
    const uninstall = installEntryDraftFlush('vehicle');
    return () => { cancelled = true; uninstall(); };
  }, []);

  // Stop anything reloading the app while the form is open. This covers what idle time cannot:
  // a guard standing in the camera for two minutes looks perfectly idle from inside the updater.
  useEffect(() => {
    if (!showForm) return undefined;
    return holdLiveUpdates('vehicle-entry-form');
  }, [showForm]);

  // Persist as it is filled. Debounced inside, and forced out the moment the app loses the
  // foreground — which is exactly when the camera opens.
  useEffect(() => {
    if (!showForm) return;
    saveEntryDraft('vehicle', {
      fields: { driverName, personVisiting, visitorType },
      photo: photoFile,
    });
  }, [showForm, driverName, personVisiting, visitorType, photoFile]);

  useEffect(() => {
    const loadVehicles = async () => {
      const cached = getCachedVehicles();
      // NightGuard fix: hydrate cache before any network work so the tab renders instantly offline.
      setVehicles(cached);
      setLoading(false);

      if (!navigator.onLine) return;

      // ✅ Always show cache immediately — guard never sees a blank screen
      const freshCached = getCachedVehicles();
      if (freshCached.length > 0) {
        setVehicles(freshCached);
      }

      try {
        const response = await api.get('/vehicles/recent');
        const serverData = response.data.map((v) => ({
          id: v.id,
          licensePlate: v.license_plate,
          makeModel: v.vehicle_make || v.vehicle_type,
          driverName: v.driver_name,
          colour: v.vehicle_color,
          contact: v.driver_contact || v.contact_number,
          personVisiting: v.visiting_unit,
          photoUrl: v.picture_url,
          visitorType: v.visitor_type,
          enteredAt: v.entered_at,
          exitedAt: v.exited_at,
          hasLeft: !!v.exited_at,
        }));

        const merged = mergeWithCachedPendingExits(serverData, getCachedVehicles());
        setVehicles(merged);
        saveCachedVehicles(merged);
      } catch {
        // Already showing cache above — no extra action needed
        // NightGuard fix: cache is truth; remote refresh failures stay silent for guards.
      }
    };

    loadVehicles();

    const handleSync = () => loadVehicles();
    const handleCacheUpdate = () => {
      if (suppressCacheEvent.current) return;
      setVehicles(getCachedVehicles());
    };
    const handleOnline = () => {
      console.log('[VehicleTab] Coming online - reloading vehicles from server');
      loadVehicles();
    };

    window.addEventListener('nightguard_sync_complete', handleSync);
    window.addEventListener('nightguard_vehicles_updated', handleCacheUpdate);
    window.addEventListener('online', handleOnline);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    return () => {
      window.removeEventListener('nightguard_sync_complete', handleSync);
      window.removeEventListener('nightguard_vehicles_updated', handleCacheUpdate);
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
      String(id).startsWith('veh_');
    const exitTime = new Date().toISOString();

    // ✅ Optimistic UI — guard sees exit immediately
    setVehicles((prev) =>
      prev.map((v) =>
        String(v.id) === String(id)
          ? { ...v, hasLeft: true, exitedAt: exitTime, _offline: true, _pendingExit: true }
          : v
      )
    );

    try {
      const result = await patch(`/vehicles/${id}/exit`, {}, {
        clientTempId: `veh_exit_${id}`,
        offlineResponse: { exited_at: exitTime, _offline: true },
        forceQueue: isTempId,
      });

      const finalExitTime = result?.exited_at || exitTime;
      const isOffline = Boolean(result?._offline);

      suppressCacheEvent.current = true;
      updateCachedVehicle(id, {
        hasLeft: true,
        exitedAt: finalExitTime,
        _offline: isOffline,
        _pendingExit: isOffline,
      });
      setVehicles((prev) =>
        prev.map((v) =>
          String(v.id) === String(id)
            ? { ...v, hasLeft: true, exitedAt: finalExitTime, _offline: isOffline, _pendingExit: isOffline }
            : v
        )
      );
      suppressCacheEvent.current = false;
    } catch {
      suppressCacheEvent.current = true;
      updateCachedVehicle(id, {
        hasLeft: true,
        exitedAt: exitTime,
        _offline: true,
        _pendingExit: true,
      });
      suppressCacheEvent.current = false;
    }
  };

  const validateForm = () => {
    const errors = {};
    if (!driverName.trim()) errors.driverName = 'Driver name is required';
    if (!personVisiting.trim()) errors.personVisiting = 'Visiting unit is required';
    if (!visitorType) errors.visitorType = 'Vehicle type is required';
    if (!photoFile && !photo) errors.photo = 'A photo is required';
    setVehicleErrors(errors);
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

  // ⚠ CRUCIAL — opening the picker launches an external activity, which backgrounds this app. On a
  // low-RAM handset Android routinely reclaims it there, and everything the guard typed plus any
  // photo already taken would be gone, silently, with the entry never made.
  //
  // The exposure here is worse than the incident wizard's: a photo is REQUIRED to submit (see
  // validateForm), so every single gate entry passes through this moment, and the text fields sit
  // ABOVE the photo button, so the guard has typed everything before reaching it.
  //
  // Both mechanisms that make this survivable are wired up above — holdLiveUpdates() while the
  // form is open, and a filesystem draft (lib/entryDraft.js) flushed on backgrounding. The flush
  // is forced here as well rather than relying on the visibilitychange listener alone: this is the
  // one call site that knows for certain the app is about to leave.
  const openPhotoPicker = (inputId) => {
    saveEntryDraft('vehicle', {
      fields: { driverName, personVisiting, visitorType },
      photo: photoFile,
    });
    void flushEntryDraft('vehicle');
    document.getElementById(inputId)?.click();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setError('');
    setSubmitting(true);

    const tempId = `veh_${Date.now()}`;
    // The DEVICE's bound site, which is what every read filters on (getCurrentSiteId in
    // services/api.js resolves the binding first). getCachedSiteSettings() is a different
    // source with a different precedence, and the two disagree in exactly the window that
    // matters on a multi-site estate: after a device is relocated on the dashboard the binding
    // updates immediately while the cached settings hold the OLD site until an online refresh
    // lands. An entry stamped with the old site is filed into another site's records and
    // vanishes from this guard's list. See lib/siteResolver.js.
    const siteId = getBoundSiteIdSync() || getCachedSiteSettings().id || null;
    // Stamp the arrival now, not when the row reaches the server. createVehicle() falls back to
    // now() when entered_at is absent, so a vehicle logged offline used to be recorded at the
    // moment the queue happened to drain rather than when it actually drove in.
    const enteredAt = new Date().toISOString();
    let pictureUrl = null;
    try {
      pictureUrl = navigator.onLine && photoFile
        ? await uploadEntryPhoto({ photo: photoFile, type: 'vehicles', tempId, siteId })
        : null;
    } catch (err) {
      console.warn('[VehicleTab] Photo upload failed, continuing without photo:', err.message);
      pictureUrl = null; // continue without photo
    }

    // Offline (or a failed online upload): carry the photo through the offline queue so it
    // uploads on sync. Without this the picture is lost the moment the entry syncs.
    const pendingPhoto = !pictureUrl ? buildPendingPhoto(photoFile) : null;

    const payload = {
      site_id: siteId,
      shift_id: shiftSession?.id || getShiftSession()?.id || null,
      guard_id: user?.id || null,
      vehicle_make: '',
      vehicle_color: '',
      driver_name: driverName,
      driver_contact: null,
      visiting_unit: personVisiting,
      visitor_type: visitorType,
      entered_at: enteredAt,
      picture_url: pictureUrl,
      ...(pendingPhoto ? { _pendingPhoto: pendingPhoto } : {}),
    };

    // ✅ Build the local entry FIRST — before any async call
    // This guarantees we always have something to show the guard
    const localEntry = {
      id: tempId,
      makeModel: payload.vehicle_make,
      driverName: payload.driver_name,
      colour: payload.vehicle_color,
      contact: payload.driver_contact,
      personVisiting: payload.visiting_unit,
      // The uploaded URL only. NEVER the local data URL: those bytes are already in the
      // offline queue as _pendingPhoto, and `cached_vehicles` is the same localStorage
      // quota, so keeping them here stores every queued photo twice. saveQueue()'s only
      // failure handling is a console.error, so a quota exception there silently discards
      // the entire outbox — one unsent form must never cost every queued write.
      // Same rule as incidentPhotos.js; the count is what tells the card a photo exists.
      photoUrl: pictureUrl || '',
      _pendingPhotoCount: pendingPhoto ? 1 : 0,
      visitorType: payload.visitor_type,
      enteredAt,
      exitedAt: null,
      hasLeft: false,
      _offline: true,       // assume offline until server confirms
      _pendingExit: false,
    };

    // Step 1: Write to cache FIRST — this survives page switches
    // Must happen before post() so even if post() hangs, entry is persisted
    const existingVehicles = getCachedVehicles();
    const dedupedWithNew = [localEntry, ...existingVehicles.filter(v => String(v.id) !== String(tempId))];
    saveCachedVehicles(dedupedWithNew);

    // Step 2: Update UI state directly (suppress the event the cache write fires)
    suppressCacheEvent.current = true;
    setVehicles((prev) => [localEntry, ...prev.filter(v => String(v.id) !== String(tempId))]);
    // Use setTimeout so the event fires and is suppressed, then we release
    setTimeout(() => { suppressCacheEvent.current = false; }, 50);

    // Step 3: Reset form and close — guard can keep working immediately.
    // The draft goes only now, after the entry is in the cache above (step 1) and therefore
    // durable. Clearing it any earlier would open a window where the work exists nowhere.
    void clearEntryDraft('vehicle');
    setRecoveredDraft(null);
    setDriverName('');
    setPersonVisiting('');
    setPhoto(null);
    setPhotoFile(null);
    setVisitorType(lookupData.vehicleTypes[0] || 'Visitor');
    setShowForm(false);
    setVehicleErrors({});
    setSubmitting(false);

    // Step 4: Attempt API in background — swap temp ID for real ID if server responds
    try {
      const response = await post('/vehicles/entry', payload, {
        clientTempId: tempId,
        // A photo still waiting to upload only ever uploads on a queue drain. Posting straight to
        // the server instead saves the entry and drops _pendingPhoto on the floor — createVehicle
        // strips it as a non-column — so the picture is lost with no error anywhere. That happens
        // whenever the storage write above failed while the database itself was reachable.
        forceQueue: Boolean(pendingPhoto),
      });

      if (response && !response._offline && response.id) {
        const confirmedEntry = {
          ...localEntry,
          id: response.id,
          enteredAt: response.entered_at || localEntry.enteredAt,
          _offline: false,
        };
        // Update cache: remove temp, add confirmed
        const currentVehicles = getCachedVehicles();
        saveCachedVehicles([confirmedEntry, ...currentVehicles.filter(v => String(v.id) !== String(tempId))]);
        suppressCacheEvent.current = true;
        setVehicles((prev) => [confirmedEntry, ...prev.filter(v => String(v.id) !== String(tempId))]);
        setTimeout(() => { suppressCacheEvent.current = false; }, 50);
      }
    } catch (err) {
      console.warn('[VehicleTab] Background post failed, entry remains in offline queue:', err.message);
    }
  };

  const visibleVehicles = useMemo(() => {
    // NightGuard fix: memoize expensive list filtering and keep blacklist changes in sync.
    return vehicles.filter((v) => {
      const normalisedSearch = search.toLowerCase();
      const matchesSearch =
        v.driverName?.toLowerCase().includes(normalisedSearch) ||
        v.personVisiting?.toLowerCase().includes(normalisedSearch);
      const matchesView = activeView === 'all' || v.visitorType === activeView;
      return matchesSearch && matchesView;
    });
  }, [vehicles, search, activeView, blacklistedVehicles]);

  if (showForm) {
    return (
      <div className="tab-content">
        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title">Register Vehicle</h2>
            {/* Closing the form is a decision to abandon the registration, so the draft goes with
                it — otherwise every abandoned form leaves a resume banner nagging on the list. An
                Android reclaim is NOT a decision, which is why that case keeps the draft. */}
            <button
              className="close-button"
              onClick={() => {
                setShowForm(false);
                setError('');
                setVehicleErrors({});
                setDriverName('');
                setPersonVisiting('');
                setPhoto(null);
                setPhotoFile(null);
                void clearEntryDraft('vehicle');
                setRecoveredDraft(null);
              }}
            >
              x
            </button>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label required">Driver Name</label>
              {/* NightGuard fix: focused field scrolls itself into view without keyboard inset changes. */}
              <input className={`form-input ${vehicleErrors.driverName ? 'error' : ''}`} value={driverName} onFocus={onFocus} onChange={(e) => setDriverName(e.target.value)} disabled={submitting} />
              {vehicleErrors.driverName && <div className="form-error">{vehicleErrors.driverName}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Visiting Unit</label>
              <input className={`form-input ${vehicleErrors.personVisiting ? 'error' : ''}`} list="vehicle-units" value={personVisiting} onFocus={onFocus} onChange={(e) => setPersonVisiting(e.target.value)} disabled={submitting} />
              <datalist id="vehicle-units">
                {lookupData.units.map((unit) => <option key={unit} value={unit} />)}
              </datalist>
              {vehicleErrors.personVisiting && <div className="form-error">{vehicleErrors.personVisiting}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Vehicle Type</label>
              <select className={`form-select ${vehicleErrors.visitorType ? 'error' : ''}`} value={visitorType} onFocus={onFocus} onChange={(e) => setVisitorType(e.target.value)} disabled={submitting}>
                {lookupData.vehicleTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
              {vehicleErrors.visitorType && <div className="form-error">{vehicleErrors.visitorType}</div>}
            </div>
            {/* NightGuard fix: photo is required for fast visual verification at the gate. */}
            <div className="photo-section">
              {photo ? (
                <img src={photo} alt="Vehicle preview" className="photo-preview" />
              ) : (
                <p className="photo-placeholder">No photo taken</p>
              )}
              <div className="photo-buttons">
                <button className="photo-button" type="button" onClick={() => openPhotoPicker('home-vehicle-camera')} disabled={submitting}>
                  Camera
                </button>
                <label className="photo-button browser-photo-button">
                  <input
                    id="home-vehicle-camera"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onFocus={onFocus}
                    onChange={handlePhotoSelect}
                    style={{ display: 'none' }}
                    disabled={submitting}
                  />
                </label>
                <button className="photo-button" type="button" onClick={() => openPhotoPicker('home-vehicle-gallery')} disabled={submitting}>
                  Gallery
                </button>
                <label className="photo-button browser-photo-button">
                  <input
                    id="home-vehicle-gallery"
                    type="file"
                    accept="image/*"
                    onFocus={onFocus}
                    onChange={handlePhotoSelect}
                    style={{ display: 'none' }}
                    disabled={submitting}
                  />
                </label>
              </div>
              {vehicleErrors.photo && <div className="form-error">{vehicleErrors.photo}</div>}
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
            <strong>Unfinished vehicle registration</strong>
            <span>
              {recoveredDraft.fields?.driverName
                ? `${recoveredDraft.fields.driverName} — `
                : ''}
              saved {new Date(recoveredDraft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {recoveredDraft.photoDropped ? ' (photo not recovered)' : ''}
            </span>
          </div>
          <div className="entry-draft-actions">
            <button
              className="entry-draft-resume"
              onClick={() => {
                const fields = recoveredDraft.fields || {};
                setDriverName(fields.driverName || '');
                setPersonVisiting(fields.personVisiting || '');
                setVisitorType(fields.visitorType || lookupData.vehicleTypes[0] || 'Visitor');
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
              onClick={() => { void clearEntryDraft('vehicle'); setRecoveredDraft(null); }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="panel-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
            Vehicles <span style={{ color: '#f87171', fontSize: 13 }}>({vehicles.filter((v) => !v.hasLeft).length} inside)</span>
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* NightGuard fix: small offline cue without interrupting the guard's workflow. */}
            {!isOnline && <span className="offline-dot-label"><span />Offline</span>}
            <button className="button-add compact" onClick={() => setShowForm(true)}>+ Add</button>
          </div>
        </div>
        <div className="chip-row">
          <button className={`filter-chip ${activeView === 'all' ? 'active' : ''}`} onClick={() => setActiveView('all')}>All</button>
          {lookupData.vehicleTypes.map((type) => (
            <button key={type} className={`filter-chip ${activeView === type ? 'active' : ''}`} onClick={() => setActiveView(type)}>
              {type}
            </button>
          ))}
          <button className={`filter-chip ${activeView === 'blacklist' ? 'active' : ''}`} onClick={() => setActiveView('blacklist')}>Blacklisted Cars</button>
        </div>
      </div>

      {activeView !== 'blacklist' && (
        <>
          <input
            type="text"
            placeholder="Search by driver or unit..."
            value={searchInput}
            onFocus={onFocus}
            onChange={(e) => setSearchInput(e.target.value)}
            className="form-input"
            style={{ marginBottom: 12 }}
          />
          {visibleVehicles.length === 0 ? (
            <div className="list-empty"><p>No vehicles found</p></div>
          ) : (
            <div className="list-container">
              {visibleVehicles.map((vehicle) => {
                const blacklistMatch = blacklistedVehicles.find(
                  (entry) => entry.licensePlate?.toLowerCase() === vehicle.licensePlate?.toLowerCase()
                );
                return (
                  <div key={vehicle.id} className="list-item" style={{ opacity: vehicle.hasLeft ? 0.55 : 1, borderLeft: vehicle.hasLeft ? '3px solid #22c55e' : '3px solid #dc2626' }}>
                    <div className="list-item-header">
                      {/* NightGuard fix: fixed thumbnail space prevents list-card layout shifts. */}
                      <div className="entry-title-row">
                        <VehicleThumbnail photoUrl={vehicle.photoUrl} label={vehicle.driverName} pending={Number(vehicle._pendingPhotoCount) > 0} />
                        <div className="list-item-title">
                          {vehicle.driverName || vehicle.visitorType || 'Vehicle'}
                          {vehicle._offline && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 6, fontWeight: 400, letterSpacing: 0.2 }}>offline</span>}
                        </div>
                      </div>
                      {!vehicle.hasLeft ? (
                        <button onClick={() => handleMarkExit(vehicle.id)} className="list-action-button">Exit</button>
                      ) : (
                        <span style={{ fontSize: 12, color: '#22c55e' }}>Left</span>
                      )}
                    </div>
                    <div className="meta-row">
                      <span className="list-item-badge">{vehicle.visitorType || 'Vehicle'}</span>
                      {blacklistMatch && <span className="danger-badge">Blacklisted</span>}
                    </div>
                    <div className="list-item-meta">Driver: {vehicle.driverName || '-'} • Unit: {vehicle.personVisiting || '-'}</div>
                    <div className="list-item-meta">Entry: {vehicle.enteredAt ? new Date(vehicle.enteredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</div>
                    {vehicle.hasLeft && <div className="list-item-meta">Exit: {vehicle.exitedAt ? new Date(vehicle.exitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</div>}
                    {blacklistMatch && <div className="inline-error" style={{ marginTop: 8 }}>{blacklistMatch.reason}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeView === 'blacklist' && (
        blacklistedVehicles.length === 0 ? (
          <div className="list-empty"><p>No blacklisted vehicles recorded</p></div>
        ) : (
          <div className="list-container">
            {blacklistedVehicles.map((entry) => (
              <div key={entry.id} className="list-item" style={{ borderLeft: '3px solid #ef4444' }}>
                <div className="list-item-header">
                  <div className="list-item-title">{entry.licensePlate}</div>
                  <button className="button-secondary" onClick={() => setBlacklistedVehicles(removeBlacklistedVehicle(entry.licensePlate))}>Remove</button>
                </div>
                <div className="list-item-meta">{entry.makeModel || '-'} {entry.colour ? `• ${entry.colour}` : ''}</div>
                <div className="list-item-meta">{entry.reason}</div>
                <div className="list-item-meta">Added: {new Date(entry.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
