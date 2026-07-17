import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import PedestrianTab from './home/PedestrianTab';
import VehicleTab from './home/VehicleTab';
import PatrolTab from './home/PatrolTab';
import { useAuth } from '../contexts/AuthContext';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { GENERAL_GUARD_ID, getLocationName } from '../lib/deviceStore';
import EndShiftModal from '../components/EndShiftModal';
import './home/home-styles.css';

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState('pedestrians');
  const [selectedGuardId, setSelectedGuardId] = useState('');
  const [guardPin, setGuardPin] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [showEndShift, setShowEndShift] = useState(false);
  const [switchSheetOpen, setSwitchSheetOpen] = useState(false);
  const pinInputRef = useRef(null);
  const { user, guards, shiftSession, switchGuard, quickSwitchEnabled } = useAuth();
  const { isOnline, queueCount } = useOfflineQueue();
  const locationName = getLocationName();

  const guardOptions = useMemo(
    () => guards.filter((guard) => (guard.user_type || guard.role) !== 'admin' && guard.is_active !== false),
    [guards]
  );

  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidHide', () => window.scrollTo(0, 0));
    return () => listener.then((handler) => handler.remove()).catch(() => null);
  }, []);

  const focusPinInView = () => {
    setTimeout(() => pinInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  };

  const submitGuardSwitch = async (guardId, nextPin = '') => {
    setSwitching(true);
    setSwitchError('');
    try {
      await switchGuard(guardId, guardId === GENERAL_GUARD_ID ? '0000' : nextPin);
      setGuardPin('');
      setSelectedGuardId('');
      setSwitchSheetOpen(false);
    } catch (err) {
      setSwitchError(err.response?.data?.error || err.message || 'Unable to switch guard');
    } finally {
      setSwitching(false);
    }
  };

  const handleSwitchGuard = async (e) => {
    e.preventDefault();
    if (!selectedGuardId || !guardPin) {
      setSwitchError('Select a guard and enter a PIN');
      return;
    }

    setSwitching(true);
    setSwitchError('');
    try {
      await submitGuardSwitch(selectedGuardId, guardPin);
    } catch (err) {
      setSwitchError(err.response?.data?.error || err.message || 'Unable to switch guard');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="home-container">
      {showEndShift && (
        <EndShiftModal
          activeShift={shiftSession}
          onClose={() => setShowEndShift(false)}
          onEnded={() => setShowEndShift(false)}
        />
      )}
      <div className="home-header">
        <div>
          <div className="home-eyebrow">Active shift</div>
          <h1 className="home-title">{shiftSession?.shiftLabel || 'Unassigned shift'}</h1>
          <p className="home-subtitle">
            {shiftSession?.activeGuardName || user?.full_name || 'No guard selected'}
            {shiftSession?.startedAt ? ` • Started ${new Date(shiftSession.startedAt).toLocaleTimeString()}` : ''}
            {locationName ? ` • ${locationName}` : ''}
          </p>
        </div>
        {quickSwitchEnabled && (
          <button type="button" className="button-secondary strong" onClick={() => setSwitchSheetOpen(true)}>
            Switch Guard
          </button>
        )}
        <button type="button" className="button-secondary strong" onClick={() => setShowEndShift(true)}>End Shift</button>
        <div className={`sync-pill ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? 'Online' : 'Offline'}
          {queueCount > 0 ? ` • ${queueCount} queued` : ''}
        </div>
      </div>

      {quickSwitchEnabled && switchSheetOpen && (
        <div className="quick-switch-backdrop" onClick={() => setSwitchSheetOpen(false)}>
          <div className="quick-switch-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="quick-switch-handle" />
            <div className="quick-switch-list">
              {guardOptions.map((guard) => {
                const isGeneral = String(guard.id) === GENERAL_GUARD_ID || guard._is_general_guard;
                const selected = String(selectedGuardId) === String(guard.id);
                const expectedPinLength = String(guard.pin || guard.guard_pin || '').length || 6;
                return (
                  <div key={guard.id} className={`quick-switch-row ${selected ? 'expanded' : ''}`}>
                    <button
                      type="button"
                      className="quick-switch-row-button"
                      disabled={switching}
                      onClick={() => {
                        if (isGeneral) {
                          submitGuardSwitch(GENERAL_GUARD_ID, '0000');
                          return;
                        }
                        setSelectedGuardId(guard.id);
                        setGuardPin('');
                      }}
                    >
                      <span>{guard.full_name}</span>
                      <small>{guard.badge_number || guard.badgeNumber || '-'}</small>
                    </button>
                    {selected && !isGeneral && (
                      <input
                        ref={pinInputRef}
                        className="quick-switch-pin"
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={guardPin}
                        onFocus={focusPinInView}
                        onChange={(event) => {
                          const nextPin = event.target.value.replace(/\D/g, '').slice(0, 6);
                          setGuardPin(nextPin);
                          if (nextPin.length >= Math.min(Math.max(expectedPinLength, 4), 6)) {
                            submitGuardSwitch(guard.id, nextPin);
                          }
                        }}
                        autoFocus
                        placeholder="••••"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {switchError && <div className="inline-error" style={{ padding: '8px 14px 12px' }}>{switchError}</div>}
          </div>
        </div>
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
