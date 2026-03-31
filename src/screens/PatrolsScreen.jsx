import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import './screens.css';
import { getPatrols } from '../services/api';

export default function PatrolsScreen() {
  const [patrols, setPatrols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchPatrols();
  }, []);

  const fetchPatrols = async () => {
    setLoading(true);
    try {
      const data = await getPatrols();
      setPatrols(data || []);
    } catch (error) {
      console.error('Failed to load patrols:', error);
      setPatrols([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchPatrols();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePatrolClick = (patrol) => {
    navigate(`/patrol/${patrol.id}`, { state: { patrol } });
  };

  

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#000' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="screen-container">
      <div className="patrols-header">
        <h1 className="patrols-title">My Patrols</h1>
        <button className="logout-button" onClick={handleLogout}>Logout</button>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        style={{ marginBottom: '20px', padding: '10px 20px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
      >
        {refreshing ? 'Refreshing...' : 'Refresh'}
      </button>
      {patrols.length === 0 ? (
        <p className="empty-message">No active patrols</p>
      ) : (
        <div className="patrols-list">
          {patrols.map((patrol) => (
            <div
              key={patrol.id}
              className="patrol-card"
              onClick={() => handlePatrolClick(patrol)}
            >
              <div>
                <div className="patrol-name">{patrol.patrol_name}</div>
                <div className="patrol-status">Status: {patrol.status}</div>
                <div className="patrol-progress">
                  Checkpoints: {patrol.checkpoints_completed}/{patrol.total_checkpoints}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}