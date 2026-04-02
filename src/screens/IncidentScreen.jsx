import React, { useState, useEffect } from 'react';
import { saveIncident, getRecentIncidents } from '../services/api';
import './IncidentScreen.css';

const CATEGORIES = [
  'Noise', 'Parking', 'Domestic', 'Security', 'Maintenance',
  'Visitor', 'Resident Emergency', 'Accident', 'Damage to Property',
  'Suspicious Activity', 'General'
];

const EMPTY_FORM = {
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
  makeModel: '',
  colour: '',
  vehiclePhoto: null,
  incidentPhotos: [],
};

export default function IncidentScreen() {
  const [view, setView] = useState('list');
  const [incidents, setIncidents] = useState([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState(EMPTY_FORM);

  useEffect(() => {
    loadIncidents();
  }, []);

  const loadIncidents = async () => {
    setLoading(true);
    try {
      const result = await getRecentIncidents();
      setIncidents(result || []);
    } catch (err) {
      console.error('Failed to load incidents:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handlePhotoCapture = (type, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (type === 'vehicle') {
        handleFormChange('vehiclePhoto', event.target?.result);
      } else {
        handleFormChange('incidentPhotos', [...(formData.incidentPhotos || []), event.target?.result]);
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

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const result = await saveIncident({
        incident_type: formData.category,
        description: `${formData.details}\n\nAction Taken: ${formData.actionTaken}\n\nComplainant: ${formData.complainantName} (${formData.complainantContact})\nIncident With: ${formData.incidentWith}\nGuard: ${formData.guardName}`,
        severity: 'low',
        location: formData.address,
      });
      setIncidents([result, ...incidents]);
      setView('list');
      setCurrentStep(1);
      setFormData(EMPTY_FORM);
      setSuccess('Incident saved successfully');
      setTimeout(() => setSuccess(''), 3000);
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
          <button className="back-button" onClick={() => { setView('list'); setCurrentStep(1); }}>← Back</button>
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
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              {errors.category && <div className="form-error">{errors.category}</div>}
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
              <input type="tel" className={`form-input ${errors.complainantContact ? 'error' : ''}`} placeholder="Contact number" value={formData.complainantContact} onChange={e => handleFormChange('complainantContact', e.target.value)} />
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
              <button type="button" className="photo-button" onClick={() => document.getElementById('vehicle-photo').click()}>📷 Capture Vehicle Photo</button>
              {formData.vehiclePhoto && <img src={formData.vehiclePhoto} alt="Vehicle" className="photo-preview" style={{ marginTop: 8, width: '100%', borderRadius: 8 }} />}
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="form-step">
            <h2>Step 4: Incident Images</h2>
            <div className="photo-section">
              <input type="file" className="photo-input" id="incident-photos" accept="image/*" capture="environment" multiple onChange={e => handlePhotoCapture('incident', e)} />
              <button type="button" className="photo-button" onClick={() => document.getElementById('incident-photos').click()}>📸 Add Photos</button>
            </div>
            {formData.incidentPhotos?.length > 0 ? (
              <div className="photos-grid">
                {formData.incidentPhotos.map((photo, idx) => (
                  <div key={idx} className="photo-grid-item">
                    <img src={photo} alt={`Incident ${idx + 1}`} />
                    <button type="button" className="photo-delete-btn" onClick={() => handleFormChange('incidentPhotos', formData.incidentPhotos.filter((_, i) => i !== idx))}>✕</button>
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading incidents...</div>
      ) : incidents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>No incidents reported yet</div>
      ) : (
        <div className="incidents-list">
          {incidents.map(incident => (
            <div key={incident.id} className="incident-card">
              <div className="incident-card-header">
                <div>
                  <div className="incident-category">{incident.incident_type}</div>
                  <div className="incident-address">{incident.location}</div>
                </div>
                <div className="incident-date">{formatDate(incident.reported_at)}</div>
              </div>
              <div className="incident-details">{incident.description?.slice(0, 80)}...</div>
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, background: incident.severity === 'high' ? '#7f1d1d' : '#1a1a1a', color: incident.severity === 'high' ? '#fca5a5' : '#666' }}>
                  {incident.severity}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}