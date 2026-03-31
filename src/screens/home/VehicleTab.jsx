import React, { useState } from 'react';
import api from '../../services/api';
import './home-styles.css';

export default function VehicleTab() {
  const [vehicles, setVehicles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('vehicle');
  const [loading, setLoading] = useState(false);

  // Vehicle form state
  const [licensePlate, setLicensePlate] = useState('');
  const [description, setDescription] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [vin, setVin] = useState('');
  const [colour, setColour] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');

  // Driver form state
  const [driverName, setDriverName] = useState('');
  const [driverIdNumber, setDriverIdNumber] = useState('');
  const [driverCardNumber, setDriverCardNumber] = useState('');
  const [driverLicenseExpiry, setDriverLicenseExpiry] = useState('');
  const [personVisiting, setPersonVisiting] = useState('');
  const [contact, setContact] = useState('');
  const [visitorType, setVisitorType] = useState('Visitor');
  const [passengers, setPassengers] = useState('');

  // Errors
  const [vehicleErrors, setVehicleErrors] = useState({});
  const [driverErrors, setDriverErrors] = useState({});
  const [error, setError] = useState('');

  const validateVehicleForm = () => {
    const errors = {};
    if (!licensePlate.trim()) errors.licensePlate = 'License plate is required';
    if (!description.trim()) errors.description = 'Description is required';
    if (!makeModel.trim()) errors.makeModel = 'Make/Model is required';
    if (!vin.trim()) errors.vin = 'VIN is required';
    if (!colour.trim()) errors.colour = 'Colour is required';
    if (!licenseExpiry.trim()) errors.licenseExpiry = 'License expiry is required';
    setVehicleErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateDriverForm = () => {
    const errors = {};
    if (!driverName.trim()) errors.driverName = 'Driver name is required';
    if (!driverIdNumber.trim()) errors.driverIdNumber = 'Driver ID number is required';
    if (!driverCardNumber.trim()) errors.driverCardNumber = 'Driver card number is required';
    if (!driverLicenseExpiry.trim()) errors.driverLicenseExpiry = 'License expiry is required';
    if (!personVisiting.trim()) errors.personVisiting = 'Person visiting is required';
    if (!contact.trim()) errors.contact = 'Contact is required';
    if (!passengers.trim()) errors.passengers = 'Number of passengers is required';
    setDriverErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const vehicleValid = validateVehicleForm();
    const driverValid = validateDriverForm();

    if (!vehicleValid || !driverValid) return;

    setError('');
    setLoading(true);
    try {
      await api.post('/vehicles/entry', {
        license_plate: licensePlate,
        description,
        make_model: makeModel,
        vin,
        colour,
        license_expiry: licenseExpiry,
        driver_name: driverName,
        driver_id_number: driverIdNumber,
        driver_card_number: driverCardNumber,
        driver_license_expiry: driverLicenseExpiry,
        person_visiting: personVisiting,
        contact_number: contact,
        visitor_type: visitorType,
        num_passengers: parseInt(passengers),
      });

      // Add to local list
      setVehicles([
        ...vehicles,
        {
          id: Date.now(),
          licensePlate,
          makeModel,
          driverName,
          description,
        },
      ]);

      // Reset form
      setLicensePlate('');
      setDescription('');
      setMakeModel('');
      setVin('');
      setColour('');
      setLicenseExpiry('');
      setDriverName('');
      setDriverIdNumber('');
      setDriverCardNumber('');
      setDriverLicenseExpiry('');
      setPersonVisiting('');
      setContact('');
      setVisitorType('Visitor');
      setPassengers('');
      setShowForm(false);
      setVehicleErrors({});
      setDriverErrors({});
      setActiveSubTab('vehicle');
    } catch (err) {
      setError(err.message || 'Failed to register vehicle');
    } finally {
      setLoading(false);
    }
  };

  if (showForm) {
    return (
      <div className="tab-content">
        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title">Register Vehicle</h2>
            <button
              className="close-button"
              onClick={() => {
                setShowForm(false);
                setVehicleErrors({});
                setDriverErrors({});
                setError('');
              }}
            >
              ✕
            </button>
          </div>

          {error && <div style={{ color: '#ef4444', textAlign: 'center', fontSize: '14px' }}>{error}</div>}

          {/* Sub-tabs */}
          <div className="subtab-bar">
            <button
              className={`subtab-button ${activeSubTab === 'vehicle' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('vehicle')}
              disabled={loading}
            >
              Vehicle Details
            </button>
            <button
              className={`subtab-button ${activeSubTab === 'driver' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('driver')}
              disabled={loading}
            >
              Driver Information
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
            {/* Vehicle Tab */}
            {activeSubTab === 'vehicle' && (
              <div>
                <div className="form-group">
                  <label className="form-label required">License Plate / Registration</label>
                  <input
                    type="text"
                    className={`form-input ${vehicleErrors.licensePlate ? 'error' : ''}`}
                    placeholder="License plate"
                    value={licensePlate}
                    onChange={(e) => setLicensePlate(e.target.value)}
                    disabled={loading}
                  />
                  {vehicleErrors.licensePlate && <div className="form-error">{vehicleErrors.licensePlate}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Description</label>
                  <input
                    type="text"
                    className={`form-input ${vehicleErrors.description ? 'error' : ''}`}
                    placeholder="Vehicle description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={loading}
                  />
                  {vehicleErrors.description && <div className="form-error">{vehicleErrors.description}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Make / Model</label>
                  <input
                    type="text"
                    className={`form-input ${vehicleErrors.makeModel ? 'error' : ''}`}
                    placeholder="e.g., Toyota Corolla"
                    value={makeModel}
                    onChange={(e) => setMakeModel(e.target.value)}
                    disabled={loading}
                  />
                  {vehicleErrors.makeModel && <div className="form-error">{vehicleErrors.makeModel}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">VIN Number</label>
                  <input
                    type="text"
                    className={`form-input ${vehicleErrors.vin ? 'error' : ''}`}
                    placeholder="Vehicle Identification Number"
                    value={vin}
                    onChange={(e) => setVin(e.target.value)}
                    disabled={loading}
                  />
                  {vehicleErrors.vin && <div className="form-error">{vehicleErrors.vin}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Colour</label>
                  <input
                    type="text"
                    className={`form-input ${vehicleErrors.colour ? 'error' : ''}`}
                    placeholder="Vehicle colour"
                    value={colour}
                    onChange={(e) => setColour(e.target.value)}
                    disabled={loading}
                  />
                  {vehicleErrors.colour && <div className="form-error">{vehicleErrors.colour}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">License Expiry Date</label>
                  <input
                    type="date"
                    className={`form-input ${vehicleErrors.licenseExpiry ? 'error' : ''}`}
                    value={licenseExpiry}
                    onChange={(e) => setLicenseExpiry(e.target.value)}
                    disabled={loading}
                  />
                  {vehicleErrors.licenseExpiry && <div className="form-error">{vehicleErrors.licenseExpiry}</div>}
                </div>
              </div>
            )}

            {/* Driver Tab */}
            {activeSubTab === 'driver' && (
              <div>
                <div className="form-group">
                  <label className="form-label required">Driver Full Name</label>
                  <input
                    type="text"
                    className={`form-input ${driverErrors.driverName ? 'error' : ''}`}
                    placeholder="Driver name"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    disabled={loading}
                  />
                  {driverErrors.driverName && <div className="form-error">{driverErrors.driverName}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Driver ID Number</label>
                  <input
                    type="text"
                    className={`form-input ${driverErrors.driverIdNumber ? 'error' : ''}`}
                    placeholder="Driver ID number"
                    value={driverIdNumber}
                    onChange={(e) => setDriverIdNumber(e.target.value)}
                    disabled={loading}
                  />
                  {driverErrors.driverIdNumber && <div className="form-error">{driverErrors.driverIdNumber}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Driver Card Number</label>
                  <input
                    type="text"
                    className={`form-input ${driverErrors.driverCardNumber ? 'error' : ''}`}
                    placeholder="Driver card number"
                    value={driverCardNumber}
                    onChange={(e) => setDriverCardNumber(e.target.value)}
                    disabled={loading}
                  />
                  {driverErrors.driverCardNumber && <div className="form-error">{driverErrors.driverCardNumber}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">License Expiry Date</label>
                  <input
                    type="date"
                    className={`form-input ${driverErrors.driverLicenseExpiry ? 'error' : ''}`}
                    value={driverLicenseExpiry}
                    onChange={(e) => setDriverLicenseExpiry(e.target.value)}
                    disabled={loading}
                  />
                  {driverErrors.driverLicenseExpiry && <div className="form-error">{driverErrors.driverLicenseExpiry}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Person Visiting</label>
                  <input
                    type="text"
                    className={`form-input ${driverErrors.personVisiting ? 'error' : ''}`}
                    placeholder="Person being visited"
                    value={personVisiting}
                    onChange={(e) => setPersonVisiting(e.target.value)}
                    disabled={loading}
                  />
                  {driverErrors.personVisiting && <div className="form-error">{driverErrors.personVisiting}</div>}
                </div>

                <div className="form-group">
                  <label className="form-label required">Contact Number</label>
                  <input
                    type="tel"
                    className={`form-input ${driverErrors.contact ? 'error' : ''}`}
                    placeholder="Contact number"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    disabled={loading}
                  />
                  {driverErrors.contact && <div className="form-error">{driverErrors.contact}</div>}
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
                  <label className="form-label required">Number of Passengers</label>
                  <input
                    type="number"
                    className={`form-input ${driverErrors.passengers ? 'error' : ''}`}
                    placeholder="Number of passengers"
                    value={passengers}
                    onChange={(e) => setPassengers(e.target.value)}
                    disabled={loading}
                    min="1"
                  />
                  {driverErrors.passengers && <div className="form-error">{driverErrors.passengers}</div>}
                </div>
              </div>
            )}

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
        <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Registered Vehicles</h2>
        <button className="button-add" onClick={() => setShowForm(true)} style={{ width: 'auto', padding: '8px 16px', minHeight: '40px' }}>
          + Add
        </button>
      </div>

      {vehicles.length === 0 ? (
        <div className="list-empty">
          <p>No vehicles registered yet</p>
          <p style={{ fontSize: '12px', marginTop: '8px', color: '#555' }}>Click Add to register a vehicle</p>
        </div>
      ) : (
        <div className="list-container">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="list-item">
              <div className="list-item-header">
                <div className="list-item-title">{vehicle.licensePlate}</div>
              </div>
              <div className="list-item-meta">
                {vehicle.makeModel}
              </div>
              <div className="list-item-meta">
                Driver: {vehicle.driverName}
              </div>
              <div className="list-item-meta">
                {vehicle.description}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
