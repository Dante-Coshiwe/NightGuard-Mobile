import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './screens.css';

export default function ReportIncidentScreen() {
  const [incidentType, setIncidentType] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const submitIncident = async (e) => {
    e.preventDefault();
    if (!incidentType || !description) {
      setError('Please fill in type and description');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.post('/incidents/report', { incident_type: incidentType, description, severity });
      alert('Incident reported successfully');
      navigate(-1);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1 className="form-title">Report Incident</h1>
      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
      <form onSubmit={submitIncident}>
        <input
          type="text"
          className="form-input"
          placeholder="Incident Type"
          value={incidentType}
          onChange={(e) => setIncidentType(e.target.value)}
          required
          disabled={loading}
        />
        <textarea
          className="form-textarea"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows="4"
          required
          disabled={loading}
        />
        <div className="form-group">
          <label className="form-label">Severity:</label>
          <select
            className="form-select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            disabled={loading}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <button type="submit" className="button-submit" disabled={loading}>
          {loading ? <span className="loading-spinner"></span> : 'Submit Report'}
        </button>
      </form>
    </div>
  );
}