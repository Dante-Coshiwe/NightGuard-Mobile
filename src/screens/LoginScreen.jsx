
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './screens.css';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
  console.error('Full error:', err);
  console.error('Response:', err.response?.data);
  console.error('Status:', err.response?.status);
  setError(err.response?.data?.error || err.message || 'Login failed');
} finally {
      setLoading(false);
    }
    
  };

  return (
    <div className="login-container">
      <div className="login-inner">
        <h1 className="login-title">NightGuard</h1>
        <form onSubmit={handleLogin}>
          {error && <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}
          <input
            type="email"
            className="form-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
          <input
            type="password"
            className="form-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
          <button type="submit" className="button-submit" disabled={loading}>
            {loading ? <span className="loading-spinner"></span> : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}