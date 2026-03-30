import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const STATUS_COLORS = {
  completed: '#10b981',
  in_progress: '#f59e0b',
  pending: '#6b7280',
};

export default function PatrolsScreen() {
  const [patrols, setPatrols] = useState([]);
  const [loading, setLoading] = useState(true);
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchPatrols();
  }, []);

  const fetchPatrols = async () => {
    try {
      const res = await api.get('/guard/patrols');
      setPatrols(res.data);
    } catch (err) {
      console.error('Failed to load patrols:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (loading) {
    return <div style={styles.center}>Loading...</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.heading}>Active Patrols</h2>
        <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
      </div>
      <div style={styles.list}>
        {patrols.map((patrol) => {
          const color = STATUS_COLORS[patrol.status] || '#6b7280';
          const progress = patrol.total_checkpoints > 0
            ? patrol.checkpoints_completed / patrol.total_checkpoints
            : 0;
          return (
            <div
              key={patrol.id}
              style={styles.card}
              onClick={() => navigate(/patrol/)}
            >
              <div style={styles.cardHeader}>
                <span style={styles.patrolName}>{patrol.patrol_name}</span>
                <span style={{ ...styles.badge, backgroundColor: color + '22', color }}>
                  {patrol.status.replace('_', ' ')}
                </span>
              </div>
              <div style={styles.progressRow}>
                <span style={styles.progressText}>
                  {patrol.checkpoints_completed} / {patrol.total_checkpoints} checkpoints
                </span>
              </div>
              <div style={styles.progressBarBg}>
                // FIXED
<div style={{ width: `${progress * 100}%`, backgroundColor: color, height: '4px', borderRadius: '2px' }} />
              </div>
            </div>
          );
        })}
        {patrols.length === 0 && <p style={styles.empty}>No patrols assigned</p>}
      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#000000', minHeight: '100vh', padding: '20px' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#000000', color: '#fff' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  heading: { color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0 },
  logoutBtn: { backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: '12px' },
  card: { backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '10px', padding: '16px', cursor: 'pointer' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  patrolName: { color: '#ffffff', fontSize: '16px', fontWeight: '600' },
  badge: { padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', textTransform: 'capitalize' },
  progressRow: { marginBottom: '6px' },
  progressText: { color: '#888888', fontSize: '13px' },
  progressBarBg: { height: '4px', backgroundColor: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' },
  empty: { color: '#666666', textAlign: 'center', marginTop: '40px' },
};
