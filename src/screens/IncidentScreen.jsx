import React, { useState, useEffect } from 'react';
import { saveIncident, getAllIncidents } from '../services/api';
import './IncidentScreen.css';

// Step 1: Basic Info
const BasicInfoStep = ({ data, onChange, errors }) => {
  const incidentCategories = [
    'Noise', 'Parking', 'Domestic', 'Security', 'Maintenance',
    'Visitor', 'Resident Emergency', 'Accident', 'Damage to Property',
    'Suspicious Activity', 'General'
  ];

  return (
    <div className="form-step">
      <h2>Step 1: Basic Information</h2>

      <div className="form-group">
        <label className="form-label required">Date & Time</label>
        <input
          type="datetime-local"
          className={`form-input ${errors.dateTime ? 'error' : ''}`}
          value={data.dateTime}
          onChange={(e) => onChange('dateTime', e.target.value)}
        />
        {errors.dateTime && <div className="form-error">{errors.dateTime}</div>}
      </div>

      <div className="form-group">
        <label className="form-label required">Incident Category</label>
        <select
          className={`form-select ${errors.category ? 'error' : ''}`}
          value={data.category}
          onChange={(e) => onChange('category', e.target.value)}
        >
          <option value="">Select category</option>
          {incidentCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        {errors.category && <div className="form-error">{errors.category}</div>}
      </div>

      <div className="form-group">
        <label className="form-label required">Address</label>
        <input
          type="text"
          className={`form-input ${errors.address ? 'error' : ''}`}
          placeholder="Incident address"
          value={data.address}
          onChange={(e) => onChange('address', e.target.value)}
        />
        {errors.address && <div className="form-error">{errors.address}</div>}
      </div>

      <div className="form-group">
        <label className="form-label required">Complainant Name</label>
        <input
          type="text"
          className={`form-input ${errors.complainantName ? 'error' : ''}`}
          placeholder="Name"
          value={data.complainantName}
          onChange={(e) => onChange('complainantName', e.target.value)}
        />
        {errors.complainantName && <div className="form-error">{errors.complainantName}</div>}
      </div>

      <div className="form-group">
        <label className="form-label required">Complainant Contact Number</label>
        <input
          type="tel"
          className={`form-input ${errors.complainantContact ? 'error' : ''}`}
          placeholder="Contact number"
          value={data.complainantContact}
          onChange={(e) => onChange('complainantContact', e.target.value)}
        />
        {errors.complainantContact && <div className="form-error">{errors.complainantContact}</div>}
      </div>

      <div className="form-group">
        <label className="form-label required">Incident With</label>
        <div className="radio-group">
          {['Staff', 'Owner', 'Visitor', 'Other'].map((option) => (
            <label key={option} className="radio-label">
              <input
                type="radio"
                name="incidentWith"
                value={option}
                checked={data.incidentWith === option}
                onChange={(e) => onChange('incidentWith', e.target.value)}
              />
              {option}
            </label>
          ))}
        </div>
        {errors.incidentWith && <div className="form-error">{errors.incidentWith}</div>}
      </div>

      <div className="form-group">
        <label className="form-label">Offender Address</label>
        <input
          type="text"
          className="form-input"
          placeholder="Offender address (optional)"
          value={data.offenderAddress}
          onChange={(e) => onChange('offenderAddress', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Offender Details</label>
        <textarea
          className="form-textarea"
          placeholder="Physical description, vehicle info, etc."
          value={data.offenderDetails}
          onChange={(e) => onChange('offenderDetails', e.target.value)}
          rows="3"
        />
      </div>

      <div className="form-group">
        <label className="form-label required">Name of Guard Responding</label>
        <input
          type="text"
          className={`form-input ${errors.guardName ? 'error' : ''}`}
          placeholder="Guard name"
          value={data.guardName}
          onChange={(e) => onChange('guardName', e.target.value)}
        />
        {errors.guardName && <div className="form-error">{errors.guardName}</div>}
      </div>
    </div>
  );
};

// Step 2: Details
const DetailsStep = ({ data, onChange, errors }) => {
  return (
    <div className="form-step">
      <h2>Step 2: Details</h2>

      <div className="form-group">
        <label className="form-label required">Incident Details</label>
        <textarea
          className={`form-textarea ${errors.details ? 'error' : ''}`}
          placeholder="Provide detailed information about the incident"
          value={data.details}
          onChange={(e) => onChange('details', e.target.value)}
          rows="5"
        />
        {errors.details && <div className="form-error">{errors.details}</div>}
      </div>

      <div className="form-group">
        <label className="form-label required">Action Taken</label>
        <textarea
          className={`form-textarea ${errors.actionTaken ? 'error' : ''}`}
          placeholder="What action was taken in response?"
          value={data.actionTaken}
          onChange={(e) => onChange('actionTaken', e.target.value)}
          rows="5"
        />
        {errors.actionTaken && <div className="form-error">{errors.actionTaken}</div>}
      </div>
    </div>
  );
};

// Step 3: Vehicle
const VehicleStep = ({ data, onChange, errors, onPhotoCapture }) => {
  return (
    <div className="form-step">
      <h2>Step 3: Vehicle Information</h2>

      <div className="form-group">
        <label className="form-label">Registration</label>
        <input
          type="text"
          className="form-input"
          placeholder="License plate"
          value={data.registration}
          onChange={(e) => onChange('registration', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input
          type="text"
          className="form-input"
          placeholder="Vehicle description"
          value={data.description}
          onChange={(e) => onChange('description', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Make/Model</label>
        <input
          type="text"
          className="form-input"
          placeholder="e.g., Toyota Corolla"
          value={data.makeModel}
          onChange={(e) => onChange('makeModel', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">VIN</label>
        <input
          type="text"
          className="form-input"
          placeholder="Vehicle Identification Number"
          value={data.vin}
          onChange={(e) => onChange('vin', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Colour</label>
        <input
          type="text"
          className="form-input"
          placeholder="Vehicle colour"
          value={data.colour}
          onChange={(e) => onChange('colour', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">License Expiry</label>
        <input
          type="date"
          className="form-input"
          value={data.licenseExpiry}
          onChange={(e) => onChange('licenseExpiry', e.target.value)}
        />
      </div>

      <div className="photo-section">
        <label className="form-label">Photo of Vehicle</label>
        <input
          type="file"
          className="photo-input"
          id="vehicle-photo"
          accept="image/*"
          capture="environment"
          onChange={(e) => onPhotoCapture('vehicle', e)}
        />
        <button
          type="button"
          className="photo-button"
          onClick={() => document.getElementById('vehicle-photo').click()}
        >
          📷 Capture Vehicle Photo
        </button>
        {data.vehiclePhoto && (
          <div className="photo-preview-container">
            <img src={data.vehiclePhoto} alt="Vehicle" className="photo-preview" />
            <span style={{ fontSize: '12px', color: '#666' }}>Photo captured ✓</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Step 4: Images
const ImagesStep = ({ data, onChange, onPhotoCapture }) => {
  return (
    <div className="form-step">
      <h2>Step 4: Incident Images</h2>
      <p style={{ color: '#999', fontSize: '13px', marginBottom: '16px' }}>
        Upload or capture images related to the incident
      </p>

      <div className="photo-section">
        <input
          type="file"
          className="photo-input"
          id="incident-photos"
          accept="image/*"
          capture="environment"
          multiple
          onChange={(e) => onPhotoCapture('incident', e)}
        />
        <button
          type="button"
          className="photo-button"
          onClick={() => document.getElementById('incident-photos').click()}
        >
          📸 Add Photos
        </button>
      </div>

      {data.incidentPhotos && data.incidentPhotos.length > 0 && (
        <div className="photos-grid">
          {data.incidentPhotos.map((photo, idx) => (
            <div key={idx} className="photo-grid-item">
              <img src={photo} alt={`Incident ${idx + 1}`} />
              <button
                type="button"
                className="photo-delete-btn"
                onClick={() => {
                  const newPhotos = data.incidentPhotos.filter((_, i) => i !== idx);
                  onChange('incidentPhotos', newPhotos);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {(!data.incidentPhotos || data.incidentPhotos.length === 0) && (
        <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
          No photos added yet
        </div>
      )}
    </div>
  );
};

export default function IncidentScreen() {
  const [view, setView] = useState('list'); // 'list' or 'form'
  const [incidents, setIncidents] = useState([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [errors, setErrors] = useState({});

  const [formData, setFormData] = useState({
    dateTime: new Date().toISOString().slice(0, 16),
    category: '',
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
    description: '',
    makeModel: '',
    vin: '',
    colour: '',
    licenseExpiry: '',
    vehiclePhoto: null,
    incidentPhotos: [],
  });

  // Load incidents on mount
  useEffect(() => {
    loadIncidents();
  }, []);

  const loadIncidents = async () => {
    setLoading(true);
    try {
      const result = await getAllIncidents();
      if (result.success) {
        setIncidents(result.data || []);
      }
    } catch (err) {
      console.error('Failed to load incidents:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    if (errors[field]) {
      setErrors({ ...errors, [field]: '' });
    }
  };

  const handlePhotoCapture = (type, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (type === 'vehicle') {
        handleFormChange('vehiclePhoto', event.target?.result);
      } else if (type === 'incident') {
        const photos = formData.incidentPhotos || [];
        handleFormChange('incidentPhotos', [...photos, event.target?.result]);
      }
    };
    reader.readAsDataURL(file);
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

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    setCurrentStep(currentStep - 1);
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      const result = await saveIncident(formData);
      if (result.success) {
        setSuccess('Incident saved successfully');
        setIncidents([result.data, ...incidents]);
        setView('list');
        setCurrentStep(1);
        setFormData({
          dateTime: new Date().toISOString().slice(0, 16),
          category: '',
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
          description: '',
          makeModel: '',
          vin: '',
          colour: '',
          licenseExpiry: '',
          vehiclePhoto: null,
          incidentPhotos: [],
        });
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || 'Failed to save incident');
      }
    } catch (err) {
      setError('Error saving incident');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (view === 'form') {
    return (
      <div className="incident-container">
        <div className="incident-header">
          <h1>New Incident Report</h1>
          <button className="close-button" onClick={() => setView('list')}>✕</button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <div className="form-wrapper">
          {currentStep === 1 && <BasicInfoStep data={formData} onChange={handleFormChange} errors={errors} />}
          {currentStep === 2 && <DetailsStep data={formData} onChange={handleFormChange} errors={errors} />}
          {currentStep === 3 && <VehicleStep data={formData} onChange={handleFormChange} errors={errors} onPhotoCapture={handlePhotoCapture} />}
          {currentStep === 4 && <ImagesStep data={formData} onChange={handleFormChange} onPhotoCapture={handlePhotoCapture} />}

          <div className="form-navigation">
            {currentStep > 1 && (
              <button className="button-secondary" onClick={handlePrevStep} disabled={submitting}>
                ← Previous
              </button>
            )}
            {currentStep < 4 && (
              <button className="button-primary" onClick={handleNextStep} disabled={submitting}>
                Next →
              </button>
            )}
            {currentStep === 4 && (
              <button className="button-submit" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : 'Submit Incident'}
              </button>
            )}
          </div>

          <div className="step-indicator">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className={`step-dot ${step === currentStep ? 'active' : ''} ${step < currentStep ? 'completed' : ''}`}>
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="incident-container">
      <div className="incident-header">
        <h1>Incidents</h1>
        <button className="button-add" onClick={() => setView('form')}>+ Add Incident</button>
      </div>

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#666' }}>Loading incidents...</div>
      ) : incidents.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: '#666' }}>
          <p>No incidents recorded yet</p>
          <p style={{ fontSize: '12px', marginTop: '8px' }}>Click "Add Incident" to create one</p>
        </div>
      ) : (
        <div className="incidents-list">
          {incidents.map((incident) => (
            <div key={incident.id} className="incident-card">
              <div className="incident-card-header">
                <div>
                  <div className="incident-category">{incident.category}</div>
                  <div className="incident-address">{incident.address}</div>
                </div>
                <div className="incident-date">{new Date(incident.dateTime).toLocaleDateString()}</div>
              </div>
              <div className="incident-details">
                <span>{incident.complainantName}</span> • <span>{incident.guardName}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
