import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './screens.css';
import { registerPedestrian } from '../services/api';

export default function RegisterPedestrianScreen() {
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [contact, setContact] = useState('');
  const [visitingUnit, setVisitingUnit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhoto(e.target?.result);
      };
      reader.readAsDataURL(file);
    }
  };

const submitEntry = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');
  try {
    await registerPedestrian({
      full_name: name,          // was fullName (undefined)
      id_number: idNumber,
      contact_number: contact,  // was contactNumber (undefined)
      visiting_unit: visitingUnit,
    });
    navigate('/');
  } catch (err) {
    setError(err.message || 'Failed to register');
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="form-container">
      <h1 className="form-title">Register Person</h1>
      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
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
          disabled={loading}
        />
        <input
          type="tel"
          className="form-input"
          placeholder="Contact Number"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          disabled={loading}
        />
        <input
          type="text"
          className="form-input"
          placeholder="Visiting Unit"
          value={visitingUnit}
          onChange={(e) => setVisitingUnit(e.target.value)}
          disabled={loading}
        />

        <div className="photo-section">
          {photo ? (
            <img src={photo} alt="Preview" className="photo-preview" />
          ) : (
            <p className="photo-placeholder">No photo taken</p>
          )}
          <div className="photo-buttons">
            <label className="photo-button">
              📷 Camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                style={{ display: 'none' }}
                disabled={loading}
              />
            </label>
            <label className="photo-button">
              🖼️ Gallery
              <input
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
    </div>
  );
}