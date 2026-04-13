import React, { useMemo, useState } from 'react';
import PedestrianTab from './home/PedestrianTab';
import VehicleTab from './home/VehicleTab';
import PatrolTab from './home/PatrolTab';
import { useAuth } from '../contexts/AuthContext';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import './home/home-styles.css';

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState('pedestrians');
  const [selectedGuardId, setSelectedGuardId] = useState('');
  const [guardPin, setGuardPin] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [switching, setSwitching] = useState(false);
  const { user, guards, shiftSession, switchGuard, quickSwitchEnabled } = useAuth();
  const { isOnline, queueCount } = useOfflineQueue();

  const guardOptions = useMemo(
    () => guards.filter((guard) => (guard.user_type || guard.role) !== 'admin'),
    [guards]
  );

  const handleSwitchGuard = async (e) => {
    e.preventDefault();
    if (!selectedGuardId || !guardPin) {
      setSwitchError('Select a guard and enter a PIN');
      return;
    }

    setSwitching(true);
    setSwitchError('');
    try {
      await switchGuard(selectedGuardId, guardPin);
      setGuardPin('');
      setSelectedGuardId('');
    } catch (err) {
      setSwitchError(err.response?.data?.error || err.message || 'Unable to switch guard');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="home-container">
      <div className="home-header">
        <div>
          <div className="home-eyebrow">Active shift</div>
          <h1 className="home-title">{shiftSession?.shiftLabel || 'Unassigned shift'}</h1>
          <p className="home-subtitle">
            {user?.full_name || 'No guard selected'}
            {shiftSession?.startedAt ? ` • Started ${new Date(shiftSession.startedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <div className={`sync-pill ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? 'Online' : 'Offline'}
          {queueCount > 0 ? ` • ${queueCount} queued` : ''}
        </div>
      </div>

      {quickSwitchEnabled && (
        <form className="switch-panel" onSubmit={handleSwitchGuard}>
          <div className="switch-panel-title">Quick guard switch</div>
          <div className="switch-grid">
            <select className="form-select" value={selectedGuardId} onChange={(e) => setSelectedGuardId(e.target.value)}>
              <option value="">Select guard</option>
              {guardOptions.map((guard) => (
                <option key={guard.id} value={guard.id}>
                  {guard.full_name}
                </option>
              ))}
            </select>
            <input
              className="form-input"
              type="password"
              value={guardPin}
              onChange={(e) => setGuardPin(e.target.value)}
              placeholder="PIN"
              inputMode="numeric"
              maxLength={6}
            />
            <button className="button-secondary strong" type="submit" disabled={switching}>
              {switching ? 'Switching...' : 'Switch'}
            </button>
          </div>
          {switchError && <div className="inline-error">{switchError}</div>}
        </form>
      )}

      {activeTab === 'pedestrians' && <PedestrianTab />}
      {activeTab === 'vehicles' && <VehicleTab />}
      {activeTab === 'patrols' && <PatrolTab />}

      <div className="tab-bar">
        <button className={`tab-button ${activeTab === 'pedestrians' ? 'active' : ''}`} onClick={() => setActiveTab('pedestrians')}>
          Pedestrians
        </button>
        <button className={`tab-button ${activeTab === 'vehicles' ? 'active' : ''}`} onClick={() => setActiveTab('vehicles')}>
          Vehicles
        </button>
        <button className={`tab-button ${activeTab === 'patrols' ? 'active' : ''}`} onClick={() => setActiveTab('patrols')}>
          Patrol
        </button>
      </div>
    </div>
  );
}
