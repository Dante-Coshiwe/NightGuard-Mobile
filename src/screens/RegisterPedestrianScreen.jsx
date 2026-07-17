import React, { useEffect, useState } from 'react';
import './screens.css';
import { useOfflineApi } from '../hooks/useOfflineApi';
import {
  getCachedPedestrians,
  getCachedSiteSettings,
  getShiftSession,
  updateCachedPedestrian,
  upsertCachedPedestrian,
} from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';
import { buildPendingPhoto, normaliseSelectedPhoto, uploadEntryPhoto } from '../lib/photoCapture';

export default function RegisterPedestrianScreen() {
  const { user, shiftSession } = useAuth();
  const [recentPedestrians, setRecentPedestrians] = useState(getCachedPedestrians());
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [visitingUnit, setVisitingUnit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { post, patch } = useOfflineApi();

  useEffect(() => {
    const handleUpdate = () => setRecentPedestrians(getCachedPedestrians());
    window.addEventListener('nightguard_pedestrians_updated', handleUpdate);
    return () => window.removeEventListener('nightguard_pedestrians_updated', handleUpdate);
  }, []);

  const appendToCachedPedestrians = (entry) => {
    upsertCachedPedestrian({
      id: entry.id,
      name: entry.full_name,
      contact: entry.contact_number,
      visitorType: entry.purpose_of_visit || 'Visitor',
      unitVisiting: entry.visiting_unit,
      hostName: entry.host_name || '',
      photoUrl: entry.picture_url || entry.photoUrl || '',
      entryTime: entry.entry_time || new Date().toISOString(),
      exitTime: null,
      hasLeft: false,
      isPrecleared: Boolean(entry.is_precleared),
      _offline: Boolean(entry._offline),
      _pendingExit: false,
    });
  };

  const handleMarkExit = async (id) => {
    const exitTime = new Date().toISOString();
    const isTempId = String(id).startsWith('offline_') || String(id).startsWith('temp_') || String(id).startsWith('ped_') || String(id).startsWith('reg_ped_');

    try {
      const result = await patch(`/pedestrians/${id}/exit`, {}, {
        clientTempId: `ped_exit_${id}`,
        offlineResponse: { exit_time: exitTime, _offline: true },
        forceQueue: isTempId,
      });

      updateCachedPedestrian(id, {
        hasLeft: true,
        exitTime: result?.exit_time || exitTime,
        _offline: Boolean(result?._offline),
        _pendingExit: Boolean(result?._offline),
      });
    } catch {
      updateCachedPedestrian(id, {
        hasLeft: true,
        exitTime,
        _offline: true,
        _pendingExit: true,
      });
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      normaliseSelectedPhoto(file).then((selectedPhoto) => {
        setPhotoFile(selectedPhoto);
        setPhoto(selectedPhoto.dataUrl);
      }).catch(() => setError('Could not load the selected photo'));
    }
  };

  const openPhotoPicker = (inputId) => {
    document.getElementById(inputId)?.click();
  };

  const submitEntry = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (!name.trim() || !visitingUnit.trim()) {
      setLoading(false);
      setError('Full name and visiting unit are required');
      return;
    }
    if (!photoFile && !photo) {
      setLoading(false);
      setError('A photo is required');
      return;
    }

    try {
      const clientTempId = `reg_ped_${Date.now()}`;
      const siteId = getCachedSiteSettings().id || null;
      const pictureUrl = navigator.onLine && photoFile
        ? await uploadEntryPhoto({ photo: photoFile, type: 'pedestrians', tempId: clientTempId, siteId })
        : null;
      // Carry an offline-captured photo through the queue so it uploads on sync instead of being lost.
      const pendingPhoto = !pictureUrl ? buildPendingPhoto(photoFile) : null;
      console.log(`[RegisterPedestrianScreen] Registering pedestrian offline: ${name}, tempId=${clientTempId}`);
      const result = await post(
        '/pedestrians/entry',
        {
          site_id: siteId,
          shift_id: shiftSession?.id || getShiftSession()?.id || null,
          guard_id: user?.id || null,
          full_name: name,
          id_number: idNumber,
          contact_number: null,
          visiting_unit: visitingUnit,
          picture_url: pictureUrl,
          ...(pendingPhoto ? { _pendingPhoto: pendingPhoto } : {}),
        },
        {
          clientTempId,
          offlineResponse: {
            id: clientTempId,
            full_name: name,
            id_number: idNumber,
            contact_number: null,
            visiting_unit: visitingUnit,
            picture_url: pictureUrl || photo,
            entry_time: new Date().toISOString(),
            _offline: true,
          },
        }
      );

      console.log(`[RegisterPedestrianScreen] Pedestrian response:`, result);
      appendToCachedPedestrians(result);

      setName('');
      setIdNumber('');
      setVisitingUnit('');
      setPhoto(null);
      setPhotoFile(null);
      const message = result?._offline ? 'Person saved offline on this device (will sync online)' : 'Person registered successfully';
      console.log(`[RegisterPedestrianScreen] Success: ${message}`);
      setSuccess(message);
    } catch (err) {
      console.error(`[RegisterPedestrianScreen] ERROR:`, err.message);
      setError(err.message || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1 className="form-title">Register Person</h1>
      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', marginBottom: '16px', textAlign: 'center' }}>{success}</div>}
      <form onSubmit={submitEntry}>
        <input
          type="text"
          className="form-input"
          placeholder="Full Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={loading}
        />
        <input
          type="text"
          className="form-input"
          placeholder="ID Number (optional)"
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          inputMode="numeric"
          disabled={loading}
        />
        <input
          type="text"
          className="form-input"
          placeholder="Visiting Unit"
          value={visitingUnit}
          onChange={(e) => setVisitingUnit(e.target.value)}
          disabled={loading}
          required
        />

        <div className="photo-section">
          {photo ? (
            <img src={photo} alt="Preview" className="photo-preview" />
          ) : (
            <p className="photo-placeholder">No photo taken</p>
          )}
          <div className="photo-buttons">
            <button className="photo-button" type="button" onClick={() => openPhotoPicker('pedestrian-camera')} disabled={loading}>
              Camera
            </button>
            <label className="photo-button browser-photo-button">
              <input
                id="pedestrian-camera"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                style={{ display: 'none' }}
                disabled={loading}
              />
            </label>
            <button className="photo-button" type="button" onClick={() => openPhotoPicker('pedestrian-gallery')} disabled={loading}>
              Gallery
            </button>
            <label className="photo-button browser-photo-button">
              <input
                id="pedestrian-gallery"
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                style={{ display: 'none' }}
                disabled={loading}
              />
            </label>
          </div>
        </div>

        <button type="submit" className="button-submit" disabled={loading}>
          {loading ? <span className="loading-spinner"></span> : 'Register Entry'}
        </button>
      </form>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12, color: '#fff' }}>
          Recent People <span style={{ color: '#f87171', fontSize: 13 }}>({recentPedestrians.filter((person) => !person.hasLeft).length} inside)</span>
        </h2>
        {recentPedestrians.length === 0 ? (
          <div className="list-empty"><p>No people logged yet</p></div>
        ) : (
          <div className="list-container">
            {recentPedestrians.map((person) => (
              <div key={person.id} className="list-item" style={{ opacity: person.hasLeft ? 0.55 : 1, borderLeft: person.hasLeft ? '3px solid #22c55e' : '3px solid #dc2626' }}>
                <div className="list-item-header">
                  <div className="list-item-title">{person.name || 'Unknown'}</div>
                  {!person.hasLeft ? (
                    <button onClick={() => handleMarkExit(person.id)} className="list-action-button" type="button">Exit</button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#22c55e' }}>Left</span>
                  )}
                </div>
                <div className="list-item-meta">Unit: {person.unitVisiting || '-'} • Host: {person.hostName || '-'}</div>
                <div className="list-item-meta">
                  Entry: {person.entryTime ? new Date(person.entryTime).toLocaleString() : '-'}
                  {person.exitTime ? ` • Exit: ${new Date(person.exitTime).toLocaleString()}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
