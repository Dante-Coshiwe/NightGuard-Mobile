import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createOBEntry } from '../services/api';
import './screens.css';
import { useOfflineApi } from '../hooks/useOfflineApi';

export default function OBEntryScreen() {
  const [serialNumber, setSerialNumber] = useState('');
  const [nature, setNature] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { post, isOnline } = useOfflineApi();


  const submitEntry = async (e) => {
    e.preventDefault();
    if (!nature) {
      setError('Please enter the nature of occurrence');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const response = await post('/ob-entries', { serial_number: serialNumber, nature_of_occurrence: nature });
      
      // Handle offline response:
      if (response._offline) {
        alert('OB entry recorded successfully (offline)');
        navigate(-1);
        return;
      }

      alert('OB entry recorded successfully');
      navigate(-1);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1 className="form-title">Occurrence Book Entry</h1>
      {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
      <form onSubmit={submitEntry}>
        <input
          type="text"
          className="form-input"
          placeholder="Serial Number (optional)"
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
          disabled={loading}
        />
        <textarea
          className="form-textarea"
          placeholder="Nature of Occurrence"
          value={nature}
          onChange={(e) => setNature(e.target.value)}
          rows="4"
          required
          disabled={loading}
        />
        <button type="submit" className="button-submit" disabled={loading}>
          {loading ? <span className="loading-spinner"></span> : 'Submit Entry'}
        </button>
      </form>
    </div>
  );
}
