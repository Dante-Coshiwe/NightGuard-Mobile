import React, { useState, useEffect } from 'react';
import PedestrianTab from './home/PedestrianTab';
import VehicleTab from './home/VehicleTab';
import PatrolTab from './home/PatrolTab';
import './home/home-styles.css';

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState('pedestrians');
  const [completedPatrols, setCompletedPatrols] = useState([]);

  // Initialize completed patrols from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('completedPatrols');
    if (stored) {
      try {
        setCompletedPatrols(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load completed patrols:', e);
      }
    }
  }, []);

  // Save completed patrols to sessionStorage whenever they change
  useEffect(() => {
    sessionStorage.setItem('completedPatrols', JSON.stringify(completedPatrols));
  }, [completedPatrols]);

  const handleCompletePatrol = (patrol) => {
    setCompletedPatrols([...completedPatrols, patrol]);
  };

  return (
    <div className="home-container">
      {/* Tab Content */}
      {activeTab === 'pedestrians' && <PedestrianTab />}
      {activeTab === 'vehicles' && <VehicleTab />}
      {activeTab === 'patrols' && (
        <PatrolTab completedPatrols={completedPatrols} onCompletePatrol={handleCompletePatrol} />
      )}

      {/* Tab Bar at Bottom */}
      <div className="tab-bar">
        <button
          className={`tab-button ${activeTab === 'pedestrians' ? 'active' : ''}`}
          onClick={() => setActiveTab('pedestrians')}
        >
          Pedestrians
        </button>
        <button
          className={`tab-button ${activeTab === 'vehicles' ? 'active' : ''}`}
          onClick={() => setActiveTab('vehicles')}
        >
          Vehicles
        </button>
        <button
          className={`tab-button ${activeTab === 'patrols' ? 'active' : ''}`}
          onClick={() => setActiveTab('patrols')}
        >
          Patrol
        </button>
      </div>
    </div>
  );
}
