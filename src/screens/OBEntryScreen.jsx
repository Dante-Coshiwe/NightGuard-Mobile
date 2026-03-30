import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function OBEntryScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    serial_number: '',
    nature_of_occurrence: '',
    action_taken: '',
    officer_name: '',
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nature_of_occurrence) {
      alert('Nature of occurrence is required');
      return;
    }
    setLoading(true);
    try {
      await api.post('/obentries', form);
      alert('OB entry saved');
      navigate('/');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back</button>
      <h2 style={styles.title}>Occurrence Book Entry</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label}>Serial Number</label>
          <input type="text" name="serial_number" value={form.serial_number} onChange={handleChange} style={styles.input} />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Officer Name</label>
          <input type="text" name="officer_name" value={form.officer_name} onChange={handleChange} style={styles.input} />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Nature of Occurrence *</label>
          <textarea name="nature_of_occurrence" value={form.nature_of_occurrence} onChange={handleChange} style={styles.textarea} rows="4" />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Action Taken</label>
          <textarea name="action_taken" value={form.action_taken} onChange={handleChange} style={styles.textarea} rows="3" />
        </div>
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Saving...' : 'Save Entry'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#000000', minHeight: '100vh', padding: '20px' },
  backBtn: { background: 'none', border: 'none', color: '#dc2626', fontSize: '15px', cursor: 'pointer', marginBottom: '16px' },
  title: { color: '#ffffff', fontSize: '22px', fontWeight: 'bold', marginBottom: '20px' },
  form: { maxWidth: '500px', margin: '0 auto' },
  field: { marginBottom: '16px' },
  label: { display: 'block', color: '#999999', fontSize: '13px', marginBottom: '6px' },
  input: { width: '100%', padding: '12px', backgroundColor: '#1a1a1a', color: '#ffffff', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '16px', outline: 'none' },
  textarea: { width: '100%', padding: '12px', backgroundColor: '#1a1a1a', color: '#ffffff', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '16px', fontFamily: 'inherit', outline: 'none' },
  button: { width: '100%', padding: '12px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', marginTop: '8px' },
};
