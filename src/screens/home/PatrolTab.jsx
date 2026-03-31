import React, { useState, useEffect } from 'react';
import './home-styles.css';

export default function PatrolTab({ completedPatrols, onCompletePatrol }) {
  const [isActive, setIsActive] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Timer effect
  useEffect(() => {
    if (!isActive || !startTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive, startTime]);

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const formatTimeShort = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const handleStartPatrol = () => {
    setStartTime(Date.now());
    setIsActive(true);
    setElapsedTime(0);
  };

  const handleEndPatrol = () => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    const startTimeStr = startDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const endTimeStr = endDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const patrol = {
      id: startTime,
      startTime: startTimeStr,
      endTime: endTimeStr,
      duration: duration,
      durationStr: formatTimeShort(duration),
    };

    onCompletePatrol(patrol);

    setIsActive(false);
    setStartTime(null);
    setElapsedTime(0);
  };

  return (
    <div className="tab-content">
      <div className="patrol-container">
        {!isActive ? (
          <>
            {completedPatrols.length === 0 ? (
              <>
                <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                  <p style={{ color: '#666', marginBottom: '16px' }}>No active patrol</p>
                </div>
                <button className="button-add" onClick={handleStartPatrol}>
                  ▶ Start Patrol
                </button>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                  <p style={{ color: '#666', marginBottom: '16px' }}>Patrol Complete</p>
                </div>
                <button className="button-add" onClick={handleStartPatrol}>
                  ▶ Start New Patrol
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <div>
              <div className="timer-label">Current Patrol Duration</div>
              <div className="timer-display">{formatTime(elapsedTime)}</div>
            </div>
            <button className="button-add" onClick={handleEndPatrol} style={{ background: '#7f1d1d', marginTop: '16px' }}>
              ⏹ End Patrol
            </button>
          </>
        )}

        {/* Completed Patrols */}
        {completedPatrols.length > 0 && (
          <>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Completed Patrols</h3>
              <div className="patrol-history">
                {completedPatrols.map((patrol, idx) => (
                  <div key={patrol.id} className="patrol-item">
                    <div className="patrol-item-time">
                      Patrol {completedPatrols.length - idx} • {patrol.startTime} - {patrol.endTime}
                    </div>
                    <div className="patrol-item-duration">
                      Duration: {patrol.durationStr}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="patrol-message">
          ℹ More patrol features coming soon
        </div>
      </div>
    </div>
  );
}
