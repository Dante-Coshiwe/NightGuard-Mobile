import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getRecentIncidents } from '../services/api';
import './IncidentScreen.css';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { isAppOnline } from '../lib/connectivity';
import { getCachedSiteSettings, getLookupData, getShiftSession } from '../lib/deviceStore';
import { getBoundSiteIdSync } from '../lib/siteResolver';
import { getCachedIncidents, setCachedIncidents } from '../lib/reportCache';
import { useAuth } from '../contexts/AuthContext';
import {
  buildPendingPhotos,
  normaliseSelectedPhoto,
  normaliseSelectedPhotos,
  uploadEntryPhoto,
  uploadEntryPhotos,
} from '../lib/photoCapture';
import { incidentPhotoUrls, pendingPhotoCount, stripPendingPhotosFromList } from '../lib/incidentPhotos';
import { summariseDevices } from '../lib/deviceAttribution';
import { getCurrentDeviceRecord } from '../services/schemaData';
import DeviceBreakdown from '../components/DeviceBreakdown';
import {
  clearIncidentDraft,
  draftHasContent,
  flushIncidentDraft,
  installIncidentDraftFlush,
  loadIncidentDraft,
  saveIncidentDraft,
} from '../lib/incidentDraft';
import { holdLiveUpdates } from '../services/liveUpdate';

// An incident is evidence, not an album. The cap keeps a queued incident's base64 photos inside the
// storage the offline queue shares with everything else — see stripPendingPhotos.
const MAX_INCIDENT_PHOTOS = 6;

// `datetime-local` inputs are LOCAL time with no zone. toISOString() is UTC, so prefilling with it
// showed a time shifted by the UTC offset (13:26 displayed while the wall clock read 15:26). That
// was invisible for as long as the field was validated and then thrown away; now that the guard's
// stated time is what gets stored, it would have back-dated every incident by the offset.
function localDateTimeInput(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// A function, not a constant: as a module-level object the timestamp was frozen at app load, so
// every incident reported in a session after the first was prefilled with a stale time.
const emptyForm = () => ({
  dateTime: localDateTimeInput(),
  category: '',
  severity: 'low',
  address: '',
  complainantName: '',
  complainantContact: '',
  incidentWith: '',
  offenderAddress: '',
  offenderDetails: '',
  guardName: '',
  details: '',
  actionTaken: '',
  registration: '',
  makeModel: '',
  colour: '',
  vehiclePhoto: null,
  incidentPhotos: [],
});

export default function IncidentScreen() {
  const { user, shiftSession } = useAuth();
  const [view, setView] = useState('list');
  const [incidents, setIncidents] = useState([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState(emptyForm);
  const [lookupData, setLookupData] = useState(getLookupData());
  const [viewerPhotos, setViewerPhotos] = useState(null);
  // Bumped the moment a submit starts. A refresh whose fetch was already in flight is answering a
  // question from before that submit, so applying it would drop the incident the guard just filed
  // off the list AND out of the cache — see loadIncidents.
  const submitSeq = useRef(0);
  // An unfinished report recovered from disk, offered back rather than silently reinstated —
  // see lib/incidentDraft.js for everything that can destroy the form mid-write.
  const [recoveredDraft, setRecoveredDraft] = useState(null);
  const { post } = useOfflineApi();

  useEffect(() => {
    let cancelled = false;
    loadIncidentDraft().then((draft) => {
      if (!cancelled && draftHasContent(draft)) setRecoveredDraft(draft);
    }).catch(() => null);
    return installIncidentDraftFlush();
  }, []);

  // Stop anything reloading the app while the wizard is open. This covers what idle time
  // cannot: a guard standing in the camera for two minutes looks perfectly idle from inside
  // the updater. Keyed on `view` alone so it is taken once, not churned on every keystroke.
  useEffect(() => {
    if (view !== 'form') return undefined;
    return holdLiveUpdates('incident-form');
  }, [view]);

  // Persist as it is filled. Debounced inside, and forced out the moment the app loses the
  // foreground — which is exactly when the camera opens.
  useEffect(() => {
    if (view !== 'form') return;
    saveIncidentDraft({ formData, currentStep });
  }, [view, formData, currentStep]);

  useEffect(() => {
    loadIncidents();
  }, []);

  useEffect(() => {
    const handleLookupUpdate = () => setLookupData(getLookupData());
    window.addEventListener('nightguard_lookup_updated', handleLookupUpdate);
    return () => window.removeEventListener('nightguard_lookup_updated', handleLookupUpdate);
  }, []);

  // `silent` is the difference between opening the page and refreshing it. Only the first paint
  // may show "Loading incidents…" — see useLiveRefresh for why a refresh must never take the list
  // away, and how often it would otherwise have done so.
  const loadIncidents = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const seq = submitSeq.current;

    // The cache first, always and whatever the connection is doing, so the list is readable the
    // instant the page opens and with no signal at all.
    let cached = [];
    try {
      cached = await getCachedIncidents();
    } catch (err) {
      console.error('[IncidentScreen] Could not read cached incidents:', err);
    }

    if (!silent && cached.length) {
      setIncidents(cached);
      setLoading(false);
    }

    try {
      if (!isAppOnline()) {
        setIncidents(cached);
        return;
      }

      const result = await getRecentIncidents();

      // A submit started while this was in flight. Its optimistic write is newer than anything this
      // answer can contain, so this one is thrown away rather than written over it.
      if (submitSeq.current !== seq) return;

      const data = result || [];

      // Keep queued/offline items visible until the server's own copy replaces them.
      const offlineItems = (cached || []).filter((i) => i?._offline);
      const remoteIds = new Set(data.map((i) => String(i?.id)));
      const merged = [
        ...offlineItems.filter((i) => !remoteIds.has(String(i?.id))),
        ...data,
      ];

      setIncidents(merged);
      await setCachedIncidents(stripPendingPhotosFromList(merged));

    } catch (err) {
      console.error('[IncidentScreen] Failed to load incidents:', err);

      // Never blank the list because a refresh failed — what is on screen is still true.
      if (cached.length) setIncidents(cached);

    } finally {
      setLoading(false);
    }
  };

  useLiveRefresh(() => loadIncidents({ silent: true }));

  // Whose incidents are these? On a one-handset site this is a no-op — `mine` is every row and the
  // breakdown renders nothing. It only bites when a second device starts filing here.
  const deviceSummary = useMemo(() => summariseDevices(incidents, {
    deviceRowId: getCurrentDeviceRecord()?.id || null,
    devices: getCachedSiteSettings()?.devices || [],
    timestampKey: 'reported_at',
  }), [incidents]);
  const visibleIncidents = deviceSummary.mine;

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  // Photos are held as descriptors ({ dataUrl, blob, ... }), not bare data URLs. The blob is what
  // gets uploaded; the data URL is both the on-screen preview and what survives into the offline
  // queue, since a Blob JSON.stringifies to `{}` and the picture would be lost on the way there.
  const handlePhotoCapture = async (type, e) => {
    const input = e.target;
    const files = input.files;
    if (!files?.length) return;
    setError('');
    try {
      if (type === 'vehicle') {
        const photo = await normaliseSelectedPhoto(files[0]);
        handleFormChange('vehiclePhoto', photo);
      } else {
        const photos = await normaliseSelectedPhotos(files);
        setFormData((prev) => {
          const combined = [...(prev.incidentPhotos || []), ...photos];
          if (combined.length > MAX_INCIDENT_PHOTOS) {
            setError(`Up to ${MAX_INCIDENT_PHOTOS} incident photos — the extra ones were not added.`);
          }
          return { ...prev, incidentPhotos: combined.slice(0, MAX_INCIDENT_PHOTOS) };
        });
      }
    } catch (err) {
      console.error('[IncidentScreen] Could not read selected photo:', err);
      setError('Could not read that photo. Try taking it again.');
    } finally {
      // Without this, picking the same file twice in a row fires no change event the second time.
      input.value = '';
    }
  };

  const validateStep = (step) => {
    const newErrors = {};
    if (step === 1) {
      if (!formData.dateTime) newErrors.dateTime = 'Date & Time required';
      if (!formData.category) newErrors.category = 'Category required';
      if (!formData.address) newErrors.address = 'Address required';
      if (!formData.complainantName) newErrors.complainantName = 'Name required';
      if (!formData.complainantContact) newErrors.complainantContact = 'Contact required';
      if (!formData.incidentWith) newErrors.incidentWith = 'Required';
      if (!formData.guardName) newErrors.guardName = 'Guard name required';
    } else if (step === 2) {
      if (!formData.details) newErrors.details = 'Details required';
      if (!formData.actionTaken) newErrors.actionTaken = 'Action taken required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    submitSeq.current += 1;
    try {
      const clientTempId = `incident_${Date.now()}`;
      // When the incident happened, as the guard stated it. Two bugs met here: the guard-editable
      // "Date & Time" field was validated as required and then never sent, and reported_at existed
      // only on offlineResponse (the optimistic on-screen copy) rather than on the payload — so
      // createIncident fell back to now() and filed the incident at whatever time the queue
      // happened to drain. A datetime-local value is local time, which is what new Date() assumes.
      const reportedAt = (() => {
        const stated = formData.dateTime ? new Date(formData.dateTime) : null;
        return stated && !Number.isNaN(stated.getTime())
          ? stated.toISOString()
          : new Date().toISOString();
      })();
      const siteId = getBoundSiteIdSync() || getCachedSiteSettings().id || null;
      const incidentPhotos = formData.incidentPhotos || [];
      const vehiclePhoto = formData.vehiclePhoto || null;

      // Upload now if there is signal; otherwise the photos ride the offline queue as _pendingPhotos
      // and are uploaded on drain. A failed upload must never cost the incident itself — the guard's
      // written account of what happened is worth more than the picture of it, so this only ever
      // downgrades to the queued path.
      let photoUrls = [];
      let uploadFailed = false;
      // isAppOnline(), not navigator.onLine — it is the same predicate useOfflineApi uses to decide
      // whether to queue. If the two disagree, this uploads nothing while the post goes straight
      // online, and createIncident drops _pendingPhotos as a non-column: the photos would vanish.
      if (isAppOnline() && (incidentPhotos.length || vehiclePhoto)) {
        try {
          photoUrls = await uploadEntryPhotos({
            photos: incidentPhotos,
            type: 'incidents',
            tempId: clientTempId,
            siteId,
          });
          if (vehiclePhoto) {
            const vehicleUrl = await uploadEntryPhoto({
              photo: vehiclePhoto,
              type: 'incidents',
              tempId: `${clientTempId}-vehicle`,
              siteId,
            });
            if (vehicleUrl) photoUrls.push(vehicleUrl);
          }
        } catch (err) {
          console.warn('[IncidentScreen] Photo upload failed, queueing photos for sync:', err.message);
          photoUrls = [];
          uploadFailed = true;
        }
      }

      const pendingPhotos = (photoUrls.length === 0 && (incidentPhotos.length || vehiclePhoto))
        ? buildPendingPhotos([...incidentPhotos, ...(vehiclePhoto ? [vehiclePhoto] : [])])
        : [];

      // Everything the guard typed goes into the record. Steps 1, 3 and 4 collected the offender
      // description and the vehicle's registration/make/colour, validated them, and then built a
      // description that mentioned none of them — the incidents table has no columns for any of it,
      // so it was simply discarded on submit. It is part of the narrative now.
      const section = (label, value) => (value && String(value).trim() ? `${label}: ${String(value).trim()}` : null);
      const vehicleLine = [formData.registration, formData.makeModel, formData.colour]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' · ');
      const description = [
        formData.details,
        section('Action Taken', formData.actionTaken),
        [
          section('Complainant', `${formData.complainantName} (${formData.complainantContact})`),
          section('Incident With', formData.incidentWith),
          section('Guard', formData.guardName),
        ].filter(Boolean).join('\n'),
        section('Offender', formData.offenderDetails),
        section('Offender Address', formData.offenderAddress),
        section('Vehicle', vehicleLine),
      ].filter(Boolean).join('\n\n');

      const payload = {
        site_id: siteId,
        shift_id: shiftSession?.id || getShiftSession()?.id || null,
        reported_by: user?.id || null,
        guard_id: user?.id || null,
        reported_at: reportedAt,
        incident_type: formData.category,
        description,
        // Was hardcoded 'low'. The manager dashboard badges severity, sorts on it and headlines a
        // "high severity" count — all of which read zero forever while the only value a guard could
        // ever file was 'low'. The guard on the scene is the one who knows.
        severity: formData.severity || 'low',
        location: formData.address,
        photo_urls: photoUrls,
        picture_url: photoUrls[0] || null,
        ...(pendingPhotos.length ? { _pendingPhotos: pendingPhotos } : {}),
      };
      const result = await post('/incidents/report', payload, {
        clientTempId,
        // Photos still to upload (offline, or the storage write failed while the database was
        // reachable) must go through the queue — that is the only code path that uploads them and
        // rewrites photo_urls before the insert. Posting directly would save the incident and throw
        // the pictures away. The queue drains within the minute, so the delay costs nothing.
        forceQueue: pendingPhotos.length > 0,
        offlineResponse: {
          ...payload,
          id: clientTempId,
          _offline: true,
        },
      });
      const updated = [result, ...incidents];
      // State keeps the captured photos so the guard sees them on the card straight away; the cache
      // gets the stripped copy, because those bytes already live in the offline queue.
      setIncidents(updated);
      await setCachedIncidents(stripPendingPhotosFromList(updated));
      setView('list');
      setCurrentStep(1);
      setFormData(emptyForm());
      // The report is in the outbox now; the draft has done its job.
      await clearIncidentDraft();
      setRecoveredDraft(null);
      const photoNote = pendingPhotos.length
        ? ` — ${pendingPhotos.length} photo${pendingPhotos.length === 1 ? '' : 's'} will upload when there is signal`
        : (photoUrls.length ? ` with ${photoUrls.length} photo${photoUrls.length === 1 ? '' : 's'}` : '');
      setSuccess(
        (result._offline || uploadFailed)
          ? `Incident saved offline and queued for sync${photoNote}`
          : `Incident saved successfully${photoNote}`
      );
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving incident');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (ts) => ts ? new Date(ts).toLocaleDateString() : '';

  // FORM VIEW
  if (view === 'form') {
    return (
      <div className="incident-container">
        <div className="incident-header">
          {/* Backing out is a decision to abandon the report, so the draft goes with it —
              otherwise every abandoned form leaves a resume banner nagging on the list. A
              reload is NOT a decision, which is why that case keeps the draft. */}
          <button
            className="back-button"
            onClick={async () => {
              setView('list');
              setCurrentStep(1);
              setFormData(emptyForm());
              await clearIncidentDraft();
              setRecoveredDraft(null);
            }}
          >
            ← Back
          </button>
          <h1>Report Incident</h1>
        </div>

        <div className="step-indicator">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`step-dot ${currentStep === s ? 'active' : currentStep > s ? 'completed' : ''}`}>{s}</div>
          ))}
        </div>

        {error && <div className="error-message">{error}</div>}

        {currentStep === 1 && (
          <div className="form-step">
            <h2>Step 1: Basic Information</h2>
            <div className="form-group">
              <label className="form-label required">Date & Time</label>
              <input type="datetime-local" className={`form-input ${errors.dateTime ? 'error' : ''}`} value={formData.dateTime} onChange={e => handleFormChange('dateTime', e.target.value)} />
              {errors.dateTime && <div className="form-error">{errors.dateTime}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Incident Category</label>
              <select className={`form-select ${errors.category ? 'error' : ''}`} value={formData.category} onChange={e => handleFormChange('category', e.target.value)}>
                <option value="">Select category</option>
                {lookupData.incidentTypes.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              {errors.category && <div className="form-error">{errors.category}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Severity</label>
              <div className="radio-group">
                {[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([value, label]) => (
                  <label key={value} className="radio-label">
                    <input type="radio" name="severity" value={value} checked={formData.severity === value} onChange={e => handleFormChange('severity', e.target.value)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label required">Address</label>
              <input type="text" className={`form-input ${errors.address ? 'error' : ''}`} placeholder="Incident address" value={formData.address} onChange={e => handleFormChange('address', e.target.value)} />
              {errors.address && <div className="form-error">{errors.address}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Complainant Name</label>
              <input type="text" className={`form-input ${errors.complainantName ? 'error' : ''}`} placeholder="Name" value={formData.complainantName} onChange={e => handleFormChange('complainantName', e.target.value)} />
              {errors.complainantName && <div className="form-error">{errors.complainantName}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Complainant Contact</label>
              <input type="tel" inputMode="tel" autoComplete="tel" className={`form-input ${errors.complainantContact ? 'error' : ''}`} placeholder="Contact number" value={formData.complainantContact} onChange={e => handleFormChange('complainantContact', e.target.value)} />
              {errors.complainantContact && <div className="form-error">{errors.complainantContact}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Incident With</label>
              <div className="radio-group">
                {['Staff', 'Owner', 'Visitor', 'Other'].map(option => (
                  <label key={option} className="radio-label">
                    <input type="radio" name="incidentWith" value={option} checked={formData.incidentWith === option} onChange={e => handleFormChange('incidentWith', e.target.value)} />
                    {option}
                  </label>
                ))}
              </div>
              {errors.incidentWith && <div className="form-error">{errors.incidentWith}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Offender Details</label>
              <textarea className="form-textarea" placeholder="Physical description, vehicle info, etc." value={formData.offenderDetails} onChange={e => handleFormChange('offenderDetails', e.target.value)} rows="3" />
            </div>
            <div className="form-group">
              <label className="form-label required">Guard Responding</label>
              <input type="text" className={`form-input ${errors.guardName ? 'error' : ''}`} placeholder="Guard name" value={formData.guardName} onChange={e => handleFormChange('guardName', e.target.value)} />
              {errors.guardName && <div className="form-error">{errors.guardName}</div>}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="form-step">
            <h2>Step 2: Details</h2>
            <div className="form-group">
              <label className="form-label required">Incident Details</label>
              <textarea className={`form-textarea ${errors.details ? 'error' : ''}`} placeholder="Provide detailed information about the incident" value={formData.details} onChange={e => handleFormChange('details', e.target.value)} rows="5" />
              {errors.details && <div className="form-error">{errors.details}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Action Taken</label>
              <textarea className={`form-textarea ${errors.actionTaken ? 'error' : ''}`} placeholder="What action was taken in response?" value={formData.actionTaken} onChange={e => handleFormChange('actionTaken', e.target.value)} rows="5" />
              {errors.actionTaken && <div className="form-error">{errors.actionTaken}</div>}
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="form-step">
            <h2>Step 3: Vehicle Information</h2>
            <div className="form-group">
              <label className="form-label">Registration</label>
              <input type="text" className="form-input" placeholder="License plate" value={formData.registration} onChange={e => handleFormChange('registration', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Make / Model</label>
              <input type="text" className="form-input" placeholder="e.g. Toyota Corolla" value={formData.makeModel} onChange={e => handleFormChange('makeModel', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Colour</label>
              <input type="text" className="form-input" placeholder="Vehicle colour" value={formData.colour} onChange={e => handleFormChange('colour', e.target.value)} />
            </div>
            <div className="photo-section">
              <label className="form-label">Photo of Vehicle</label>
              <input type="file" className="photo-input" id="vehicle-photo" accept="image/*" capture="environment" onChange={e => handlePhotoCapture('vehicle', e)} />
              {/* Force the draft to disk before handing control to the camera. The
                  visibilitychange flush covers a full camera activity, but Android 13+ shows
                  the photo picker as a bottom sheet that never hides the WebView — and the
                  camera is exactly where a low-RAM handset reclaims the app. */}
              <button type="button" className="photo-button" onClick={async () => { await flushIncidentDraft(); document.getElementById('vehicle-photo').click(); }}>Capture Vehicle Photo</button>
              {formData.vehiclePhoto && (
                <div className="photo-grid-item" style={{ marginTop: 8 }}>
                  <img src={formData.vehiclePhoto.dataUrl} alt="Vehicle" />
                  <button type="button" className="photo-delete-btn" onClick={() => handleFormChange('vehiclePhoto', null)}>Remove</button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="form-step">
            <h2>Step 4: Incident Images</h2>
            <div className="photo-section">
              <input type="file" className="photo-input" id="incident-photos" accept="image/*" capture="environment" multiple onChange={e => handlePhotoCapture('incident', e)} />
              <button type="button" className="photo-button" onClick={async () => { await flushIncidentDraft(); document.getElementById('incident-photos').click(); }}>Add Photos</button>
            </div>
            {formData.incidentPhotos?.length > 0 ? (
              <div className="photos-grid">
                {formData.incidentPhotos.map((photo, idx) => (
                  <div key={idx} className="photo-grid-item">
                    <img src={photo.dataUrl} alt={`Incident ${idx + 1}`} />
                    <button type="button" className="photo-delete-btn" onClick={() => handleFormChange('incidentPhotos', formData.incidentPhotos.filter((_, i) => i !== idx))}>Remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>No photos added yet</div>
            )}
          </div>
        )}

        <div className="step-navigation">
          {currentStep > 1 && <button className="nav-button" onClick={() => setCurrentStep(s => s - 1)}>← Previous</button>}
          {currentStep < 4 && <button className="nav-button primary" onClick={() => { if (validateStep(currentStep)) setCurrentStep(s => s + 1); }}>Next →</button>}
          {currentStep === 4 && (
            <button className="nav-button primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Saving...' : 'Submit Incident'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // LIST VIEW
  return (
    <div className="incident-container">
      <div className="incident-header">
        <h1>Incidents</h1>
        <button className="button-add" onClick={() => setView('form')} style={{ width: 'auto', padding: '8px 16px' }}>+ Report</button>
      </div>

      {success && <div className="success-message">{success}</div>}

      {recoveredDraft && (
        <div className="incident-draft-banner">
          <div className="incident-draft-text">
            <strong>Unfinished report</strong>
            <span>
              Saved {new Date(recoveredDraft.savedAt).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              {recoveredDraft.photosDropped > 0
                ? ` — ${recoveredDraft.photosDropped} photo${recoveredDraft.photosDropped === 1 ? '' : 's'} could not be kept`
                : ''}
            </span>
          </div>
          <div className="incident-draft-actions">
            <button
              type="button"
              className="incident-draft-resume"
              onClick={() => {
                setFormData({ ...emptyForm(), ...recoveredDraft.formData });
                setCurrentStep(recoveredDraft.currentStep || 1);
                setRecoveredDraft(null);
                setView('form');
              }}
            >
              Resume
            </button>
            <button
              type="button"
              className="incident-draft-discard"
              onClick={async () => {
                await clearIncidentDraft();
                setRecoveredDraft(null);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {loading && visibleIncidents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading incidents...</div>
      ) : visibleIncidents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>No incidents reported yet</div>
      ) : (
        <div className="incidents-list">
          {visibleIncidents.map(incident => {
            const photos = incidentPhotoUrls(incident);
            // Photos waiting in the outbox with no preview to show — the card must still say they
            // exist, or a guard who reopens the app sees an incident that looks like it lost them.
            const queuedPhotos = photos.length ? 0 : pendingPhotoCount(incident);
            return (
              <div key={incident.id} className="incident-card">
                <div className="incident-card-header">
                  <div>
                    <div className="incident-category">{incident.incident_type}</div>
                    <div className="incident-address">{incident.location}</div>
                  </div>
                  <div className="incident-date">{formatDate(incident.reported_at)}</div>
                </div>
                <div className="incident-details">{incident.description?.slice(0, 80)}...</div>
                {photos.length > 0 && (
                  <div className="incident-photo-strip">
                    {photos.map((url, idx) => (
                      <button
                        key={url}
                        type="button"
                        className="incident-photo-thumb"
                        onClick={() => setViewerPhotos({ photos, index: idx })}
                        aria-label={`View photo ${idx + 1} of ${photos.length}`}
                      >
                        {/* A photo still queued for upload, or one whose file was removed from the
                            bucket, shows an empty frame rather than a broken-image glyph. */}
                        <img src={url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, background: incident.severity === 'high' ? '#7f1d1d' : '#1a1a1a', color: incident.severity === 'high' ? '#fca5a5' : '#666' }}>
                    {incident.severity}
                  </span>
                  {incident._offline && <span className="incident-pending-badge">Queued for sync</span>}
                  {queuedPhotos > 0 && (
                    <span className="incident-pending-badge">
                      {queuedPhotos} photo{queuedPhotos === 1 ? '' : 's'} waiting to upload
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DeviceBreakdown summary={deviceSummary} noun="incidents" />

      {viewerPhotos && (
        <div className="incident-photo-viewer" role="dialog" aria-modal="true" onClick={() => setViewerPhotos(null)}>
          <div className="incident-photo-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <img src={viewerPhotos.photos[viewerPhotos.index]} alt={`Incident photo ${viewerPhotos.index + 1}`} />
            <div className="incident-photo-viewer-bar">
              <button
                type="button"
                disabled={viewerPhotos.index === 0}
                onClick={() => setViewerPhotos((v) => ({ ...v, index: v.index - 1 }))}
              >
                ‹ Prev
              </button>
              <span>{viewerPhotos.index + 1} / {viewerPhotos.photos.length}</span>
              <button
                type="button"
                disabled={viewerPhotos.index >= viewerPhotos.photos.length - 1}
                onClick={() => setViewerPhotos((v) => ({ ...v, index: v.index + 1 }))}
              >
                Next ›
              </button>
              <button type="button" onClick={() => setViewerPhotos(null)}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
