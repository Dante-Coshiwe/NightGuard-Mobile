import React, { useEffect, useState } from 'react';
import { useOfflineApi } from '../hooks/useOfflineApi';
import './screens.css';
import {
  getCachedSiteSettings,
  getCachedVehicles,
  getShiftSession,
  updateCachedVehicle,
  upsertCachedVehicle,
} from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';
import { buildPendingPhoto, normaliseSelectedPhoto, uploadEntryPhoto } from '../lib/photoCapture';

export default function RegisterVehicleScreen() {
  const { user, shiftSession } = useAuth();
  const [recentVehicles, setRecentVehicles] = useState(getCachedVehicles());
  const [driverName, setDriverName] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [visitingUnit, setVisitingUnit] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { post, patch } = useOfflineApi();

  useEffect(() => {
    const handleUpdate = () => setRecentVehicles(getCachedVehicles());
    window.addEventListener('nightguard_vehicles_updated', handleUpdate);
    return () => window.removeEventListener('nightguard_vehicles_updated', handleUpdate);
  }, []);

  const appendToCachedVehicles = (entry) => {
    upsertCachedVehicle({
      id: entry.id,
      licensePlate: entry.license_plate,
      makeModel: entry.vehicle_make || entry.vehicle_type || '',
      driverName: entry.driver_name || '',
      colour: entry.vehicle_color || '',
      contact: entry.contact_number || entry.driver_contact || '',
      personVisiting: entry.visiting_unit || '',
      photoUrl: entry.picture_url || entry.photoUrl || '',
      visitorType: entry.visitor_type || entry.vehicle_type || 'Vehicle',
      enteredAt: entry.entered_at || entry.entry_time || new Date().toISOString(),
      exitedAt: null,
      hasLeft: false,
      _offline: Boolean(entry._offline),
      _pendingExit: false,
    });
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    normaliseSelectedPhoto(file).then((selectedPhoto) => {
      setPhotoFile(selectedPhoto);
      setPhoto(selectedPhoto.dataUrl);
    }).catch(() => setError('Could not load the selected photo'));
  };

  const openPhotoPicker = (inputId) => {
    document.getElementById(inputId)?.click();
  };

  const handleMarkExit = async (id) => {
    const exitTime = new Date().toISOString();
    const isTempId = String(id).startsWith('offline_') || String(id).startsWith('temp_') || String(id).startsWith('veh_') || String(id).startsWith('vehicle_');

    try {
      const result = await patch(`/vehicles/${id}/exit`, {}, {
        clientTempId: `veh_exit_${id}`,
        offlineResponse: { exited_at: exitTime, _offline: true },
        forceQueue: isTempId,
      });

      updateCachedVehicle(id, {
        hasLeft: true,
        exitedAt: result?.exited_at || exitTime,
        _offline: Boolean(result?._offline),
        _pendingExit: Boolean(result?._offline),
      });
    } catch {
      updateCachedVehicle(id, {
        hasLeft: true,
        exitedAt: exitTime,
        _offline: true,
        _pendingExit: true,
      });
    }
  };

  const submitEntry = async (e) => {
    e.preventDefault();
    if (!driverName.trim() || !visitingUnit.trim()) {
      setError('Driver name and visiting unit are required');
      return;
    }
    if (!photoFile && !photo) {
      setError('A photo is required');
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const clientTempId = `vehicle_${Date.now()}`;
      const siteId = getCachedSiteSettings().id || null;
      const pictureUrl = navigator.onLine && photoFile
        ? await uploadEntryPhoto({ photo: photoFile, type: 'vehicles', tempId: clientTempId, siteId })
        : null;
      // Carry an offline-captured photo through the queue so it uploads on sync instead of being lost.
      const pendingPhoto = !pictureUrl ? buildPendingPhoto(photoFile) : null;
      const result = await post(
        '/vehicles/entry',
        {
          site_id: siteId,
          shift_id: shiftSession?.id || getShiftSession()?.id || null,
          guard_id: user?.id || null,
          license_plate: null,
          driver_name: driverName,
          driver_contact: null,
          visitor_type: vehicleType,
          vehicle_type: vehicleType,
          visiting_unit: visitingUnit,
          picture_url: pictureUrl,
          ...(pendingPhoto ? { _pendingPhoto: pendingPhoto } : {}),
        },
        {
          clientTempId,
          offlineResponse: {
            id: clientTempId,
            license_plate: null,
            driver_name: driverName,
            driver_contact: null,
            visitor_type: vehicleType,
            vehicle_type: vehicleType,
            visiting_unit: visitingUnit,
            picture_url: pictureUrl || photo,
            entered_at: new Date().toISOString(),
            _offline: true,
          },
        }
      );

      appendToCachedVehicles(result);

      setDriverName('');
      setVehicleType('');
      setVisitingUnit('');
      setPhoto(null);
      setPhotoFile(null);
      setSuccess(result?._offline ? 'Vehicle saved offline on this device' : 'Vehicle registered successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1 className="form-title">Register Vehicle</h1>
      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', marginBottom: '16px', textAlign: 'center' }}>{success}</div>}
      <form onSubmit={submitEntry}>
        <input
          type="text"
          className="form-input"
          placeholder="Driver Name"
          value={driverName}
          onChange={(e) => setDriverName(e.target.value)}
          disabled={loading}
          required
        />
        <input
          type="text"
          className="form-input"
          placeholder="Vehicle Type"
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value)}
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
            <img src={photo} alt="Vehicle preview" className="photo-preview" />
          ) : (
            <p className="photo-placeholder">No photo taken</p>
          )}
          <div className="photo-buttons">
            <button className="photo-button" type="button" onClick={() => openPhotoPicker('vehicle-camera')} disabled={loading}>
              Camera
            </button>
            <label className="photo-button browser-photo-button">
              <input
                id="vehicle-camera"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                style={{ display: 'none' }}
                disabled={loading}
              />
            </label>
            <button className="photo-button" type="button" onClick={() => openPhotoPicker('vehicle-gallery')} disabled={loading}>
              Gallery
            </button>
            <label className="photo-button browser-photo-button">
              <input
                id="vehicle-gallery"
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
          Recent Vehicles <span style={{ color: '#f87171', fontSize: 13 }}>({recentVehicles.filter((vehicle) => !vehicle.hasLeft).length} inside)</span>
        </h2>
        {recentVehicles.length === 0 ? (
          <div className="list-empty"><p>No vehicles logged yet</p></div>
        ) : (
          <div className="list-container">
            {recentVehicles.map((vehicle) => (
              <div key={vehicle.id} className="list-item" style={{ opacity: vehicle.hasLeft ? 0.55 : 1, borderLeft: vehicle.hasLeft ? '3px solid #22c55e' : '3px solid #dc2626' }}>
                <div className="list-item-header">
                  <div className="list-item-title">{vehicle.driverName || 'Vehicle'}</div>
                  {!vehicle.hasLeft ? (
                    <button onClick={() => handleMarkExit(vehicle.id)} className="list-action-button" type="button">Exit</button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#22c55e' }}>Left</span>
                  )}
                </div>
                <div className="list-item-meta">Driver: {vehicle.driverName || '-'}</div>
                <div className="list-item-meta">{vehicle.makeModel || '-'} {vehicle.colour ? `• ${vehicle.colour}` : ''}</div>
                <div className="list-item-meta">
                  Entry: {vehicle.enteredAt ? new Date(vehicle.enteredAt).toLocaleString() : '-'}
                  {vehicle.exitedAt ? ` • Exit: ${new Date(vehicle.exitedAt).toLocaleString()}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
