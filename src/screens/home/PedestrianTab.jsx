import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { markPedestrianExit } from '../../services/api';
import './home-styles.css';

export default function PedestrianTab() {
  const [pedestrians, setPedestrians] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [contact, setContact] = useState('');
  const [visitorType, setVisitorType] = useState('Visitor');
  const [unitVisiting, setUnitVisiting] = useState('');
  const [personVisited, setPersonVisited] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    loadPedestrians();
  }, []);

  const loadPedestrians = async () => {
    setLoading(true);
    try {
      const response = await api.get('/pedestrians/recent');
      setPedestrians(response.data.map(p => ({
        id: p.id,
        name: p.full_name,
        contact: p.contact_number,
        visitorType: p.purpose_of_visit,
        unitVisiting: p.visiting_unit,
        entryTime: p.entry_time,
        exitTime: p.exit_time,
        hasLeft: !!p.exit_time,
      })));
    } catch (err) {
      console.error('Failed to load pedestrians:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkExit = async (id) => {
    try {
      await markPedestrianExit(id);
      setPedestrians(prev => prev.map(p =>
        p.id === id ? { ...p, hasLeft: true, exitTime: new Date().toISOString() } : p
      ));
    } catch (err) {
      console.error('Failed to mark exit:', err);
    }
  };

  const validateForm = () => {
    const errors = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (!contact.trim()) errors.contact = 'Contact is required';
    if (!unitVisiting.trim()) errors.unitVisiting = 'Unit Visiting is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setError('');
    setSubmitting(true);
    try {
      const response = await api.post('/pedestrians/entry', {
        full_name: name,
        id_number: idNumber,
        contact_number: contact,
        visiting_unit: unitVisiting,
        host_name: personVisited,
        purpose_of_visit: visitorType,
      });
      setPedestrians([{
        id: response.data.id,
        name: response.data.full_name,
        contact: response.data.contact_number,
        visitorType: response.data.purpose_of_visit,
        unitVisiting: response.data.visiting_unit,
        entryTime: response.data.entry_time,
        exitTime: null,
        hasLeft: false,
      }, ...pedestrians]);
      setName(''); setIdNumber(''); setContact('');
      setVisitorType('Visitor'); setUnitVisiting(''); setPersonVisited('');
      setShowForm(false); setFormErrors({});
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to register');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = pedestrians.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.contact?.includes(search) ||
    p.unitVisiting?.toLowerCase().includes(search.toLowerCase())
  );

  const inside = filtered.filter(p => !p.hasLeft).length;

  if (showForm) {
    return (
      <div className="tab-content">
        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title">Register Person</h2>
            <button className="close-button" onClick={() => { setShowForm(false); setFormErrors({}); setError(''); }}>✕</button>
          </div>
          {error && <div style={{ color: '#ef4444', textAlign: 'center', fontSize: '14px', marginBottom: 8 }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label required">Full Name</label>
              <input type="text" className={`form-input ${formErrors.name ? 'error' : ''}`} placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} disabled={submitting} />
              {formErrors.name && <div className="form-error">{formErrors.name}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">ID Number</label>
              <input type="text" className="form-input" placeholder="ID Number (optional)" value={idNumber} onChange={e => setIdNumber(e.target.value)} disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label required">Contact Number</label>
              <input type="tel" className={`form-input ${formErrors.contact ? 'error' : ''}`} placeholder="Contact Number" value={contact} onChange={e => setContact(e.target.value)} disabled={submitting} />
              {formErrors.contact && <div className="form-error">{formErrors.contact}</div>}
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
            <div className="form-group">
              <label className="form-label required">Unit Visiting</label>
              <input type="text" className={`form-input ${formErrors.unitVisiting ? 'error' : ''}`} placeholder="Unit Number or Name" value={unitVisiting} onChange={e => setUnitVisiting(e.target.value)} disabled={submitting} />
              {formErrors.unitVisiting && <div className="form-error">{formErrors.unitVisiting}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Person Being Visited</label>
              <input type="text" className="form-input" placeholder="Name of person being visited" value={personVisited} onChange={e => setPersonVisited(e.target.value)} disabled={submitting} />
            </div>
            <div className="button-group" style={{ marginTop: '24px' }}>
              <button type="submit" className="button-add" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Registration'}
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
          Persons <span style={{ color: '#f87171', fontSize: 13 }}>({inside} inside)</span>
        </h2>
        <button className="button-add" onClick={() => setShowForm(true)} style={{ width: 'auto', padding: '8px 16px', minHeight: '40px' }}>+ Add</button>
      </div>

      <input
        type="text"
        placeholder="Search by name, contact or unit..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="list-empty">
          <p>No persons found</p>
        </div>
      ) : (
        <div className="list-container">
          {filtered.map(ped => (
            <div key={ped.id} className="list-item" style={{ opacity: ped.hasLeft ? 0.5 : 1, borderLeft: ped.hasLeft ? '3px solid #22c55e' : '3px solid #dc2626' }}>
              <div className="list-item-header">
                <div className="list-item-title" style={{ textDecoration: ped.hasLeft ? 'line-through' : 'none' }}>{ped.name}</div>
                {!ped.hasLeft ? (
                  <button
                    onClick={() => handleMarkExit(ped.id)}
                    style={{ padding: '4px 10px', background: '#166534', border: 'none', borderRadius: 6, color: '#86efac', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                  >
                    ✓ Exit
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: '#22c55e' }}>✓ Left</span>
                )}
              </div>
              <div className="list-item-meta">Contact: {ped.contact}</div>
              <div className="list-item-meta">Unit: {ped.unitVisiting} · {ped.visitorType}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                In: {ped.entryTime ? new Date(ped.entryTime).toLocaleTimeString() : '-'}
                {ped.hasLeft && ped.exitTime && ` · Out: ${new Date(ped.exitTime).toLocaleTimeString()}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}