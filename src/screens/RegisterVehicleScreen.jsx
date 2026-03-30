import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera } from 'lucide-react';
import api from '../services/api';

export default function RegisterVehicleScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    registration: '',
    description: '',
    makeModel: '',
    vin: '',
    colour: '',
    licenseExpiry: '',
    vehicleImage: null,
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm({ ...form, vehicleImage: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.registration) {
      alert('Registration is required');
      return;
    }
    setLoading(true);
    try {
      await api.post('/vehicles/entry', form);
      alert('Vehicle registered');
      navigate('/');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Register Vehicle</h1>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Registration *</label>
            <input type="text" name="registration" value={form.registration} onChange={handleChange} style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Description</label>
            <input type="text" name="description" value={form.description} onChange={handleChange} style={styles.input} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Make/Model</label>
            <input type="text" name="makeModel" value={form.makeModel} onChange={handleChange} style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>VIN</label>
            <input type="text" name="vin" value={form.vin} onChange={handleChange} style={styles.input} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Colour</label>
            <input type="text" name="colour" value={form.colour} onChange={handleChange} style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>License Expiry</label>
            <input type="date" name="licenseExpiry" value={form.licenseExpiry} onChange={handleChange} style={styles.input} />
          </div>
        </div>

        <div style={styles.imageField}>
          <label style={styles.label}>Vehicle Image</label>
          {form.vehicleImage ? (
            <img src={form.vehicleImage} alt="Vehicle" style={styles.preview} />
          ) : (
            <div style={styles.imagePlaceholder}>
              <Camera size={32} color="#666" />
              <p style={styles.imageText}>Tap to take picture</p>
            </div>
          )}
          <input type="file" accept="image/*" onChange={handleImageUpload} style={styles.fileInput} />
        </div>

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Registering...' : 'Register Vehicle'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#000000', minHeight: '100vh', padding: '20px' },
  title: { color: '#ffffff', fontSize: '24px', fontWeight: 'bold', marginBottom: '24px' },
  form: { maxWidth: '800px', margin: '0 auto' },
  row: { display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' },
  field: { flex: 1, minWidth: '200px' },
  label: { display: 'block', color: '#999999', fontSize: '13px', marginBottom: '6px' },
  input: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#1a1a1a',
    color: '#ffffff',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
  },
  imageField: { textAlign: 'center', marginTop: '16px' },
  imagePlaceholder: {
    width: '200px',
    height: '200px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '8px auto',
  },
  imageText: { color: '#666', fontSize: '12px', marginTop: '8px' },
  preview: { width: '200px', height: '200px', objectFit: 'cover', borderRadius: '8px', margin: '8px auto' },
  fileInput: { marginTop: '8px', color: '#fff', fontSize: '12px' },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '24px',
  },
};