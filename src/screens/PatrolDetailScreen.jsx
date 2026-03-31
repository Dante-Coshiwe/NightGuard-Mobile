import React from 'react';
import { useParams, useLocation } from 'react-router-dom';
import './screens.css';

export default function PatrolDetailScreen() {
  const { id } = useParams();
  const location = useLocation();
  const patrol = location.state?.patrol || {};
  const checkpoints = patrol.patrol_checkpoints || [];

  const handleScan = (checkpoint) => {
    alert(`Scanning: ${checkpoint.checkpoint_name}`);
  };

  return (
    <div className="screen-container">
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff', marginBottom: '20px' }}>
        {patrol.patrol_name || 'Patrol Details'}
      </h1>
      {checkpoints.length === 0 ? (
        <p className="empty-message">No checkpoints</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {checkpoints.map((checkpoint, idx) => (
            <div
              key={idx}
              className="checkpoint-card"
              onClick={() => handleScan(checkpoint)}
            >
              <span className="checkpoint-name">{checkpoint.checkpoint_name}</span>
              <span
                className={`checkpoint-status ${checkpoint.status === 'completed' ? 'completed' : ''}`}
              >
                {checkpoint.status === 'completed' ? '✓ Completed' : '⏳ Pending'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}