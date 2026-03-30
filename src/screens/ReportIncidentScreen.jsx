import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function ReportIncidentScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    incident_type: '',
    description: '',
    severity: 'medium',
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.incident_type || !form.description) {
      alert('Incident type and description are required');
      return;
    }
    setLoading(true);
    try {
      await api.post('/incidents/report', form);
      alert('Incident reported');
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
      <h2 style={styles.title}>Report Incident</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label}>Incident Type *</label>
          <input type="text" name="incident_type" value={form.incident_type} onChange={handleChange} style={styles.input} />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Description *</label>
          <textarea name="description" value={form.description} onChange={handleChange} style={styles.textarea} rows="4" />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Severity</label>
          <select name="severity" value={form.severity} onChange={handleChange} style={styles.select}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Reporting...' : 'Report Incident'}
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
  select: { width: '100%', padding: '12px', backgroundColor: '#1a1a1a', color: '#ffffff', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '16px', outline: 'none' },
  button: { width: '100%', padding: '12px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', marginTop: '8px' },
};
