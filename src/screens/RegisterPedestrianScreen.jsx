import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload } from 'lucide-react';
import api from '../services/api';

export default function RegisterPedestrianScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    idNo: '',
    idCardNo: '',
    contactNo: '',
    visitorType: '',
    unitVisiting: '',
    personVisiting: '',
    personImage: null,
    idImage: null,
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleImageUpload = (field) => (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm({ ...form, [field]: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.unitVisiting) {
      alert('Name and Unit Visiting are required');
      return;
    }
    setLoading(true);
    try {
      await api.post('/pedestrians/entry', form);
      alert('Pedestrian registered');
      navigate('/');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Register Pedestrian</h1>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Name *</label>
            <input type="text" name="name" value={form.name} onChange={handleChange} style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>ID No.</label>
            <input type="text" name="idNo" value={form.idNo} onChange={handleChange} style={styles.input} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>ID Card No.</label>
            <input type="text" name="idCardNo" value={form.idCardNo} onChange={handleChange} style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Contact No.</label>
            <input type="tel" name="contactNo" value={form.contactNo} onChange={handleChange} style={styles.input} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Visitor Type</label>
            <input type="text" name="visitorType" value={form.visitorType} onChange={handleChange} style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Unit Visiting *</label>
            <input type="text" name="unitVisiting" value={form.unitVisiting} onChange={handleChange} style={styles.input} />
          </div>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Person Visiting</label>
          <input type="text" name="personVisiting" value={form.personVisiting} onChange={handleChange} style={styles.input} />
        </div>

        <div style={styles.imageRow}>
          <div style={styles.imageField}>
            <label style={styles.label}>Image of Person</label>
            {form.personImage ? (
              <img src={form.personImage} alt="Person" style={styles.preview} />
            ) : (
              <div style={styles.imagePlaceholder}>
                <Camera size={32} color="#666" />
              </div>
            )}
            <input type="file" accept="image/*" onChange={handleImageUpload('personImage')} style={styles.fileInput} />
          </div>
          <div style={styles.imageField}>
            <label style={styles.label}>Image of ID</label>
            {form.idImage ? (
              <img src={form.idImage} alt="ID" style={styles.preview} />
            ) : (
              <div style={styles.imagePlaceholder}>
                <Upload size={32} color="#666" />
              </div>
            )}
            <input type="file" accept="image/*" onChange={handleImageUpload('idImage')} style={styles.fileInput} />
          </div>
        </div>

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Registering...' : 'Register Entry'}
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
  imageRow: { display: 'flex', gap: '24px', marginBottom: '24px', flexWrap: 'wrap' },
  imageField: { flex: 1, textAlign: 'center' },
  imagePlaceholder: {
    width: '150px',
    height: '150px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '8px auto',
  },
  preview: { width: '150px', height: '150px', objectFit: 'cover', borderRadius: '8px', margin: '8px auto' },
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
    marginTop: '16px',
  },
};