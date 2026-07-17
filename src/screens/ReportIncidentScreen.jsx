import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './screens.css';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { getCachedSiteSettings, getLookupData, getShiftSession } from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';
import NotificationService from '../services/notificationService';

export default function ReportIncidentScreen() {
  const { user, shiftSession } = useAuth();
  const [incidentType, setIncidentType] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lookupData, setLookupData] = useState(getLookupData());
  const navigate = useNavigate();
  const { post } = useOfflineApi();

  React.useEffect(() => {
    const handleLookupUpdate = () => setLookupData(getLookupData());
    window.addEventListener('nightguard_lookup_updated', handleLookupUpdate);
    return () => window.removeEventListener('nightguard_lookup_updated', handleLookupUpdate);
  }, []);

  const submitIncident = async (e) => {
    e.preventDefault();
    if (!incidentType || !description) {
      setError('Please fill in type and description');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await post('/incidents/report', {
        site_id: getCachedSiteSettings().id || null,
        shift_id: shiftSession?.id || getShiftSession()?.id || null,
        reported_by: user?.id || null,
        guard_id: user?.id || null,
        incident_type: incidentType,
        description,
        severity,
      });

      await NotificationService.addToAppNotificationFeed({
        type: 'incident',
        title: 'Incident reported',
        body: `${incidentType}: ${description.slice(0, 80)}`,
        metadata: { shiftId: shiftSession?.id || getShiftSession()?.id || null, severity },
      });

      // Handle offline response
      if (response._offline) {
        alert('Incident saved offline and will sync when online');
        navigate(-1);
        return;
      }

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
        <select
          className="form-select"
          value={incidentType}
          onChange={(e) => setIncidentType(e.target.value)}
          required
          disabled={loading}
        >
          <option value="">Incident Type</option>
          {lookupData.incidentTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
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
