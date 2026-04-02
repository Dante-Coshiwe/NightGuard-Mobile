import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import './home-styles.css';

export default function PatrolTab({ completedPatrols, onCompletePatrol }) {
  const [patrols, setPatrols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    const loadPatrols = async () => {
      try {
        const response = await api.get('/patrols');
        setPatrols(response.data || []);
      } catch (err) {
        console.error('Failed to load patrols:', err);
      } finally {
        setLoading(false);
      }
    };
    loadPatrols();
  }, []);

  useEffect(() => {
    if (!isActive || !startTime) return;
    const interval = setInterval(() => setElapsedTime(Date.now() - startTime), 1000);
    return () => clearInterval(interval);
  }, [isActive, startTime]);

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatTimeShort = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const handleStartPatrol = () => { setStartTime(Date.now()); setIsActive(true); setElapsedTime(0); };

  const handleEndPatrol = () => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const patrol = {
      id: startTime,
      startTime: new Date(startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      endTime: new Date(endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      duration,
      durationStr: formatTimeShort(duration),
    };
    onCompletePatrol(patrol);
    setIsActive(false); setStartTime(null); setElapsedTime(0);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="patrol-container">
        {!isActive ? (
          <>
            <div style={{ textAlign: 'center', padding: '16px' }}>
              <p style={{ color: '#666', marginBottom: '16px' }}>{patrols.length === 0 ? 'No active patrol' : `${patrols.length} patrol(s) this shift`}</p>
            </div>
            <button className="button-add" onClick={handleStartPatrol}>▶ Start Patrol</button>
          </>
        ) : (
          <>
            <div>
              <div className="timer-label">Current Patrol Duration</div>
              <div className="timer-display">{formatTime(elapsedTime)}</div>
            </div>
            <button className="button-add" onClick={handleEndPatrol} style={{ background: '#7f1d1d', marginTop: '16px' }}>⏹ End Patrol</button>
          </>
        )}

        {patrols.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Shift Patrols</h3>
            <div className="patrol-history">
              {patrols.map(patrol => (
                <div key={patrol.id} className="patrol-item">
                  <div className="patrol-item-time">{patrol.patrol_name} • {patrol.status}</div>
                  <div className="patrol-item-duration">Checkpoints: {patrol.checkpoints_completed}/{patrol.total_checkpoints}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {completedPatrols.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Completed Patrols</h3>
            <div className="patrol-history">
              {completedPatrols.map((patrol, idx) => (
                <div key={patrol.id} className="patrol-item">
                  <div className="patrol-item-time">Patrol {completedPatrols.length - idx} • {patrol.startTime} - {patrol.endTime}</div>
                  <div className="patrol-item-duration">Duration: {patrol.durationStr}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="patrol-message">ℹ More patrol features coming soon</div>
      </div>
    </div>
  );
}