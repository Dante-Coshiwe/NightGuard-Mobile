import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './screens.css';

export default function RegisterVehicleScreen() {
  const [registration, setRegistration] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverContact, setDriverContact] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [visitingUnit, setVisitingUnit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const submitEntry = async (e) => {
    e.preventDefault();
    if (!registration) {
      setError('Please enter registration number');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.post('/vehicles/entry', {
        license_plate: registration,
        driver_name: driverName,
        driver_contact: driverContact,
        vehicle_type: vehicleType,
        visiting_unit: visitingUnit,
      });
      alert('Vehicle registered successfully');
      navigate(-1);
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
      <form onSubmit={submitEntry}>
        <input
          type="text"
          className="form-input"
          placeholder="Registration Number"
          value={registration}
          onChange={(e) => setRegistration(e.target.value)}
          required
          disabled={loading}
        />
        <input
          type="text"
          className="form-input"
          placeholder="Driver Name"
          value={driverName}
          onChange={(e) => setDriverName(e.target.value)}
          disabled={loading}
        />
        <input
          type="tel"
          className="form-input"
          placeholder="Driver Contact"
          value={driverContact}
          onChange={(e) => setDriverContact(e.target.value)}
          disabled={loading}
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
        />
        <button type="submit" className="button-submit" disabled={loading}>
          {loading ? <span className="loading-spinner"></span> : 'Register Entry'}
        </button>
      </form>
    </div>
  );
}