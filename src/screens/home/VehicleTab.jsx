import React, { useState, useEffect } from "react";
import api from "../../services/api";
import "./home-styles.css";
import { markVehicleExit } from '../../services/api';

export default function VehicleTab() {
  const [vehicles, setVehicles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [licensePlate, setLicensePlate] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [colour, setColour] = useState("");
  const [driverName, setDriverName] = useState("");
  const [contact, setContact] = useState("");
  const [personVisiting, setPersonVisiting] = useState("");
  const [visitorType, setVisitorType] = useState("Visitor");
  const [vehicleErrors, setVehicleErrors] = useState({});
  const [error, setError] = useState("");
  const [search, setSearch] = useState('');

  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const response = await api.get('/vehicles/recent');
        setVehicles(response.data.map(v => ({
          id: v.id,
          licensePlate: v.license_plate,
          makeModel: v.vehicle_make || v.vehicle_type,
          driverName: v.driver_name,
          colour: v.vehicle_color,
          enteredAt: v.entered_at,
          exitedAt: v.exited_at,
          hasLeft: !!v.exited_at,
        })));
      } catch (err) {
        console.error("Failed to load vehicles:", err);
      } finally {
        setLoading(false);
      }
    };
    loadVehicles();
  }, []);

  const handleMarkExit = async (id) => {
    try {
      await markVehicleExit(id);
      setVehicles(prev => prev.map(v =>
        v.id === id ? { ...v, hasLeft: true, exitedAt: new Date().toISOString() } : v
      ));
    } catch (err) {
      console.error('Failed to mark exit:', err);
    }
  };

  const validateForm = () => {
    const errors = {};
    if (!licensePlate.trim()) errors.licensePlate = "License plate is required";
    if (!driverName.trim()) errors.driverName = "Driver name is required";
    if (!contact.trim()) errors.contact = "Contact is required";
    setVehicleErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await api.post("/vehicles/entry", {
        license_plate: licensePlate,
        vehicle_make: makeModel,
        vehicle_color: colour,
        driver_name: driverName,
        driver_contact: contact,
        visiting_unit: personVisiting,
        vehicle_type: visitorType,
      });
      setVehicles([{
        id: response.data.id,
        licensePlate: response.data.license_plate,
        makeModel: response.data.vehicle_make,
        driverName: response.data.driver_name,
        colour: response.data.vehicle_color,
        enteredAt: response.data.entered_at,
      }, ...vehicles]);
      setLicensePlate(""); setMakeModel(""); setColour("");
      setDriverName(""); setContact(""); setVisitorType("Visitor");
      setPersonVisiting(""); setShowForm(false); setVehicleErrors({});
    } catch (err) {
      setError(err.response?.data?.error || "Failed to register vehicle");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px" }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="tab-content">
        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title">Register Vehicle</h2>
            <button className="close-button" onClick={() => { setShowForm(false); setError(""); setVehicleErrors({}); }}>?</button>
          </div>
          {error && <div style={{ color: "#ef4444", textAlign: "center", fontSize: "14px", marginBottom: 12 }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label required">License Plate</label>
              <input type="text" className={`form-input ${vehicleErrors.licensePlate ? "error" : ""}`} placeholder="License plate" value={licensePlate} onChange={e => setLicensePlate(e.target.value)} disabled={submitting} />
              {vehicleErrors.licensePlate && <div className="form-error">{vehicleErrors.licensePlate}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Make / Model</label>
              <input type="text" className="form-input" placeholder="e.g. Toyota Corolla" value={makeModel} onChange={e => setMakeModel(e.target.value)} disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label">Colour</label>
              <input type="text" className="form-input" placeholder="Vehicle colour" value={colour} onChange={e => setColour(e.target.value)} disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label required">Driver Name</label>
              <input type="text" className={`form-input ${vehicleErrors.driverName ? "error" : ""}`} placeholder="Driver name" value={driverName} onChange={e => setDriverName(e.target.value)} disabled={submitting} />
              {vehicleErrors.driverName && <div className="form-error">{vehicleErrors.driverName}</div>}
            </div>
            <div className="form-group">
              <label className="form-label required">Contact Number</label>
              <input type="tel" className={`form-input ${vehicleErrors.contact ? "error" : ""}`} placeholder="Contact number" value={contact} onChange={e => setContact(e.target.value)} disabled={submitting} />
              {vehicleErrors.contact && <div className="form-error">{vehicleErrors.contact}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Visiting Unit</label>
              <input type="text" className="form-input" placeholder="Unit or person visiting" value={personVisiting} onChange={e => setPersonVisiting(e.target.value)} disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label">Visitor Type</label>
              <select className="form-select" value={visitorType} onChange={e => setVisitorType(e.target.value)} disabled={submitting}>
                <option>Visitor</option>
                <option>Contractor</option>
                <option>Resident</option>
                <option>Delivery</option>
              </select>
            </div>
            <div className="button-group" style={{ marginTop: "24px" }}>
              <button type="submit" className="button-add" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Registration"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>
          Vehicles <span style={{ color: '#f87171', fontSize: 13 }}>({vehicles.filter(v => !v.hasLeft).length} inside)</span>
        </h2>
        <button className="button-add" onClick={() => setShowForm(true)} style={{ width: 'auto', padding: '8px 16px', minHeight: '40px' }}>+ Add</button>
      </div>

      <input
        type="text"
        placeholder="Search by plate, driver or unit..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading...</div>
      ) : vehicles.filter(v =>
        v.licensePlate?.toLowerCase().includes(search.toLowerCase()) ||
        v.driverName?.toLowerCase().includes(search.toLowerCase())
      ).length === 0 ? (
        <div className="list-empty"><p>No vehicles found</p></div>
      ) : (
        <div className="list-container">
          {vehicles.filter(v =>
            v.licensePlate?.toLowerCase().includes(search.toLowerCase()) ||
            v.driverName?.toLowerCase().includes(search.toLowerCase())
          ).map(vehicle => (
            <div key={vehicle.id} className="list-item" style={{ opacity: vehicle.hasLeft ? 0.5 : 1, borderLeft: vehicle.hasLeft ? '3px solid #22c55e' : '3px solid #dc2626' }}>
              <div className="list-item-header">
                <div className="list-item-title" style={{ textDecoration: vehicle.hasLeft ? 'line-through' : 'none' }}>{vehicle.licensePlate}</div>
                {!vehicle.hasLeft ? (
                  <button onClick={() => handleMarkExit(vehicle.id)}
                    style={{ padding: '4px 10px', background: '#166534', border: 'none', borderRadius: 6, color: '#86efac', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                    ✓ Exit
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: '#22c55e' }}>✓ Left</span>
                )}
              </div>
              <div className="list-item-meta">{vehicle.makeModel} {vehicle.colour ? `· ${vehicle.colour}` : ''}</div>
              <div className="list-item-meta">Driver: {vehicle.driverName}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                In: {vehicle.enteredAt ? new Date(vehicle.enteredAt).toLocaleTimeString() : '-'}
                {vehicle.hasLeft && vehicle.exitedAt && ` · Out: ${new Date(vehicle.exitedAt).toLocaleTimeString()}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
