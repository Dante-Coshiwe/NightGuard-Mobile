import React, { useState } from 'react';
import api from '../../services/api';
import './home-styles.css';

export default function PedestrianTab() {
  const [pedestrians, setPedestrians] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [idCardNumber, setIdCardNumber] = useState('');
  const [contact, setContact] = useState('');
  const [visitorType, setVisitorType] = useState('Visitor');
  const [unitVisiting, setUnitVisiting] = useState('');
  const [personVisited, setPersonVisited] = useState('');

  // Photo state
  const [facePhoto, setFacePhoto] = useState(null);
  const [facePhotoFile, setFacePhotoFile] = useState(null);
  const [idPhoto, setIdPhoto] = useState(null);
  const [idPhotoFile, setIdPhotoFile] = useState(null);

  // Errors
  const [formErrors, setFormErrors] = useState({});
  const [error, setError] = useState('');

  const handlePhotoSelect = (type, e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (type === 'face') {
          setFacePhoto(event.target?.result);
          setFacePhotoFile(file);
        } else {
          setIdPhoto(event.target?.result);
          setIdPhotoFile(file);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const validateForm = () => {
    const errors = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (!contact.trim()) errors.contact = 'Contact is required';
    if (!unitVisiting.trim()) errors.unitVisiting = 'Unit Visiting is required';
    if (!facePhotoFile) errors.facePhoto = 'Face photo is required';
    if (!idPhotoFile) errors.idPhoto = 'ID document photo is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('full_name', name);
      formData.append('id_number', idNumber);
      formData.append('id_card_number', idCardNumber);
      formData.append('contact_number', contact);
      formData.append('visitor_type', visitorType);
      formData.append('unit_visiting', unitVisiting);
      formData.append('person_being_visited', personVisited);
      if (facePhotoFile) formData.append('face_photo', facePhotoFile);
      if (idPhotoFile) formData.append('id_photo', idPhotoFile);

      await api.post('/pedestrians/entry', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Add to local list
      setPedestrians([
        ...pedestrians,
        {
          id: Date.now(),
          name,
          contact,
          visitorType,
          facePhoto,
        },
      ]);

      // Reset form
      setName('');
      setIdNumber('');
      setIdCardNumber('');
      setContact('');
      setVisitorType('Visitor');
      setUnitVisiting('');
      setPersonVisited('');
      setFacePhoto(null);
      setFacePhotoFile(null);
      setIdPhoto(null);
      setIdPhotoFile(null);
      setShowForm(false);
      setFormErrors({});
    } catch (err) {
      setError(err.message || 'Failed to register pedestrian');
    } finally {
      setLoading(false);
    }
  };

  if (showForm) {
    return (
      <div className="tab-content">
        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title">Register Person</h2>
            <button
              className="close-button"
              onClick={() => {
                setShowForm(false);
                setFormErrors({});
                setError('');
              }}
            >
              ✕
            </button>
          </div>

          {error && <div style={{ color: '#ef4444', textAlign: 'center', fontSize: '14px' }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label required">Full Name</label>
              <input
                type="text"
                className={`form-input ${formErrors.name ? 'error' : ''}`}
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
              {formErrors.name && <div className="form-error">{formErrors.name}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">ID Number</label>
              <input
                type="text"
                className="form-input"
                placeholder="ID Number (optional)"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label className="form-label">ID Card Number</label>
              <input
                type="text"
                className="form-input"
                placeholder="ID Card Number (optional)"
                value={idCardNumber}
                onChange={(e) => setIdCardNumber(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label className="form-label required">Contact Number</label>
              <input
                type="tel"
                className={`form-input ${formErrors.contact ? 'error' : ''}`}
                placeholder="Contact Number"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={loading}
              />
              {formErrors.contact && <div className="form-error">{formErrors.contact}</div>}
            </div>

            <div className="form-group">
              <label className="form-label required">Visitor Type</label>
              <select
                className="form-select"
                value={visitorType}
                onChange={(e) => setVisitorType(e.target.value)}
                disabled={loading}
              >
                <option>Visitor</option>
                <option>Contractor</option>
                <option>Resident</option>
                <option>Delivery</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label required">Unit Visiting</label>
              <input
                type="text"
                className={`form-input ${formErrors.unitVisiting ? 'error' : ''}`}
                placeholder="Unit Number or Name"
                value={unitVisiting}
                onChange={(e) => setUnitVisiting(e.target.value)}
                disabled={loading}
              />
              {formErrors.unitVisiting && <div className="form-error">{formErrors.unitVisiting}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Person Being Visited</label>
              <input
                type="text"
                className="form-input"
                placeholder="Name of person being visited"
                value={personVisited}
                onChange={(e) => setPersonVisited(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="photo-section">
              <label className="photo-label">Face Photo</label>
              <input
                type="file"
                className="photo-input"
                id="face-photo"
                accept="image/*"
                capture="user"
                onChange={(e) => handlePhotoSelect('face', e)}
              />
              <button
                type="button"
                className="photo-button"
                onClick={() => document.getElementById('face-photo').click()}
                disabled={loading}
              >
                📸 Capture Face Photo
              </button>
              {facePhoto && (
                <div className="photo-preview-container">
                  <img src={facePhoto} alt="Face" className="photo-preview" />
                  <span style={{ fontSize: '12px', color: '#666' }}>Face photo captured ✓</span>
                </div>
              )}
              {formErrors.facePhoto && <div className="form-error">{formErrors.facePhoto}</div>}
            </div>

            <div className="photo-section">
              <label className="photo-label">ID Document Photo</label>
              <input
                type="file"
                className="photo-input"
                id="id-photo"
                accept="image/*"
                capture="environment"
                onChange={(e) => handlePhotoSelect('id', e)}
              />
              <button
                type="button"
                className="photo-button"
                onClick={() => document.getElementById('id-photo').click()}
                disabled={loading}
              >
                📷 Capture ID Document
              </button>
              {idPhoto && (
                <div className="photo-preview-container">
                  <img src={idPhoto} alt="ID" className="photo-preview" />
                  <span style={{ fontSize: '12px', color: '#666' }}>ID photo captured ✓</span>
                </div>
              )}
              {formErrors.idPhoto && <div className="form-error">{formErrors.idPhoto}</div>}
            </div>

            <div className="button-group" style={{ marginTop: '24px' }}>
              <button type="submit" className="button-add" disabled={loading}>
                {loading ? 'Submitting...' : 'Submit Registration'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Registered Persons</h2>
        <button className="button-add" onClick={() => setShowForm(true)} style={{ width: 'auto', padding: '8px 16px', minHeight: '40px' }}>
          + Add
        </button>
      </div>

      {pedestrians.length === 0 ? (
        <div className="list-empty">
          <p>No persons registered yet</p>
          <p style={{ fontSize: '12px', marginTop: '8px', color: '#555' }}>Click Add to register a pedestrian</p>
        </div>
      ) : (
        <div className="list-container">
          {pedestrians.map((ped) => (
            <div key={ped.id} className="list-item">
              <div className="list-item-header">
                <div className="list-item-title">{ped.name}</div>
              </div>
              <div className="list-item-meta">
                Contact: {ped.contact}
              </div>
              <div className="list-item-meta">
                Type: {ped.visitorType}
              </div>
              {ped.facePhoto && (
                <img src={ped.facePhoto} alt={ped.name} className="photo-thumbnail" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
