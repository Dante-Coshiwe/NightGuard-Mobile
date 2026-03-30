import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Shield } from 'lucide-react';

export default function LoginScreen() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('guard@nightguard.com');
  const [password, setPassword] = useState('Guard123!');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <Shield size={64} color="#dc2626" />
        <h1 style={styles.appName}>NightGuard</h1>
        <p style={styles.subtitle}>Security Management</p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            placeholder="guard@nightguard.com"
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            placeholder="Password"
          />
        </div>
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p style={styles.hint}>Demo: guard@nightguard.com / Guard123!</p>
      </form>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    padding: '20px',
  },
  logoContainer: { textAlign: 'center', marginBottom: '48px' },
  appName: { color: '#ffffff', fontSize: '32px', fontWeight: 'bold', marginTop: '12px' },
  subtitle: { color: '#666666', fontSize: '14px', marginTop: '4px' },
  form: { width: '100%', maxWidth: '400px' },
  field: { marginBottom: '16px' },
  label: { display: 'block', color: '#999999', fontSize: '13px', marginBottom: '6px' },
  input: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#1a1a1a',
    color: '#ffffff',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    fontSize: '16px',
    outline: 'none',
  },
  button: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '8px',
  },
  hint: { textAlign: 'center', color: '#444444', fontSize: '12px', marginTop: '16px' },
};
