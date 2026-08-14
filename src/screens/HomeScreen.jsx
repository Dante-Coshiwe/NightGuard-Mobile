import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Keyboard } from '@capacitor/keyboard';
import PedestrianTab from './home/PedestrianTab';
import VehicleTab from './home/VehicleTab';
import PatrolTab from './home/PatrolTab';
import { useAuth } from '../contexts/AuthContext';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { getLocationName } from '../lib/deviceStore';
import { getActivePatrolSession, PATROL_SESSION_EVENT } from '../lib/patrolSession';
import KioskService from '../services/kioskService';
import './home/home-styles.css';

export default function HomeScreen() {
  const routerLocation = useLocation();
  // The patrol alarm sends the guard straight here, and a patrol left running must not open behind
  // the Pedestrians tab — either way the Patrol tab is what they came for.
  const [activeTab, setActiveTab] = useState(
    () => (routerLocation.state?.tab === 'patrols' || getActivePatrolSession() ? 'patrols' : 'pedestrians')
  );
  // The alarm overlays whatever screen the guard was on, so being sent here usually does NOT
  // remount this component — the tab it asked for has to be picked up from the navigation itself.
  const [lastNavKey, setLastNavKey] = useState(routerLocation.key);
  if (lastNavKey !== routerLocation.key) {
    setLastNavKey(routerLocation.key);
    if (routerLocation.state?.tab) setActiveTab(routerLocation.state.tab);
  }
  const { shiftSession } = useAuth();
  const { isOnline, queueCount } = useOfflineQueue();
  const locationName = getLocationName();
  const kioskLocked = KioskService.isEnabled();

  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidHide', () => window.scrollTo(0, 0));
    return () => listener.then((handler) => handler.remove()).catch(() => null);
  }, []);

  // A patrol STARTING anywhere (alarm, resumed session) opens the Patrol tab. Keyed on the session
  // id, not on the session event itself, so recording a route point mid-patrol never yanks the
  // guard off the tab they chose.
  const patrolSessionIdRef = useRef(getActivePatrolSession()?.id || null);
  useEffect(() => {
    const syncPatrolTab = () => {
      const id = getActivePatrolSession()?.id || null;
      if (id && id !== patrolSessionIdRef.current) setActiveTab('patrols');
      patrolSessionIdRef.current = id;
    };
    window.addEventListener(PATROL_SESSION_EVENT, syncPatrolTab);
    return () => window.removeEventListener(PATROL_SESSION_EVENT, syncPatrolTab);
  }, []);

  return (
    <div className="home-container">
      {/* The device is the unit of work, not a person. Handsets are handed between guards with no
          login, so there is no shift to name, no guard to show and nothing to end — the session
          opens by itself and stays open. Only the site and the sync state are worth the space. */}
      <div className="home-header">
        <div>
          <div className="home-eyebrow">On duty</div>
          <h1 className="home-title">{locationName || 'This site'}</h1>
        </div>
        <div className={`sync-pill ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? 'Online' : 'Offline'}
          {queueCount > 0 ? ` • ${queueCount} queued` : ''}
        </div>
      </div>

      {/* Shown only where it is actionable: on duty, on a device the admin has unlocked. On a
          kiosk-locked device the guard cannot leave anyway, so the warning would be noise. */}
      {shiftSession && !kioskLocked && (
        <div className="leave-warning">
          Leaving this app is reported. The admin is notified as soon as you leave.
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
