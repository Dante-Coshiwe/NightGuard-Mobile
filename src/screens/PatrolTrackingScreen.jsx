import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Circle, Zap } from 'lucide-react';
import { mockApi } from '../services/mockApi';

export default function PatrolTrackingScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patrol, setPatrol] = useState(null);
  const [checkpoints, setCheckpoints] = useState([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const loadPatrol = async () => {
      const patrols = await mockApi.getPatrols();
      const found = patrols.find(p => p.id === parseInt(id));
      setPatrol(found);
      setCheckpoints(found ? found.patrol_checkpoints : []);
    };
    loadPatrol();
  }, [id]);

  if (!patrol) return <div style={styles.center}>Loading...</div>;

  const completed = checkpoints.filter(c => c.status === 'completed').length;
  const total = checkpoints.length;

  const simulateScan = () => {
    const pendingIndex = checkpoints.findIndex(c => c.status !== 'completed');
    if (pendingIndex === -1) {
      alert('All checkpoints have been completed!');
      return;
    }
    const updated = [...checkpoints];
    updated[pendingIndex] = { ...updated[pendingIndex], status: 'completed' };
    setCheckpoints(updated);
    alert('✓ marked complete');
  };

  return (
    <div style={styles.container}>
      <button onClick={() => navigate('/patrols')} style={styles.backBtn}>← Back to Patrols</button>
      <h2 style={styles.title}>{patrol.patrol_name}</h2>
      <div style={styles.progressBox}>
        <div style={styles.progressLabel}>Progress</div>
        <div style={styles.progressCount}>{completed} / {total}</div>
        <div style={styles.progressBarBg}>
          <div style={{ width: `${(completed / total) * 100}%`, height: '6px', backgroundColor: '#dc2626', borderRadius: '3px' }} />
        </div>
      </div>
      <div style={styles.list}>
        {checkpoints.map((cp, idx) => (
          <div key={idx} style={styles.checkpoint}>
            {cp.status === 'completed' ? (
              <CheckCircle size={20} color="#10b981" />
            ) : (
              <Circle size={20} color="#555" />
            )}
            <div style={styles.checkpointText}>
              <div style={{ ...styles.checkpointName, color: cp.status === 'completed' ? '#888' : '#fff' }}>
                {cp.checkpoint_name}
              </div>
              <div style={{ fontSize: '12px', marginTop: '2px', color: cp.status === 'completed' ? '#10b981' : '#f59e0b' }}>
                {cp.status === 'completed' ? 'Completed' : 'Pending'}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={simulateScan} style={styles.scanBtn}>
        <Zap size={20} color="#fff" style={{ marginRight: '8px' }} />
        {completed === total ? 'All Complete ✓' : 'Scan Next Checkpoint'}
      </button>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#000000', minHeight: '100vh', padding: '20px' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#000000', color: '#fff' },
  backBtn: { background: 'none', border: 'none', color: '#dc2626', fontSize: '15px', cursor: 'pointer', marginBottom: '16px' },
  title: { color: '#ffffff', fontSize: '22px', fontWeight: 'bold', marginBottom: '16px' },
  progressBox: { backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '10px', padding: '16px', marginBottom: '20px' },
  progressLabel: { color: '#888', fontSize: '12px', marginBottom: '4px' },
  progressCount: { color: '#fff', fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' },
  progressBarBg: { height: '6px', backgroundColor: '#2a2a2a', borderRadius: '3px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' },
  checkpoint: { display: 'flex', alignItems: 'center', backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '8px', padding: '14px' },
  checkpointText: { marginLeft: '12px' },
  checkpointName: { fontSize: '15px', fontWeight: '500' },
  scanBtn: { backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' },
};