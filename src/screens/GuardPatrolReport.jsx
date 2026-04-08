import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

export default function GuardPatrolDashboard() {
  const { user } = useAuth();
  const [patrols, setPatrols] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState('own'); // 'own' or 'all' (for admin)

  useEffect(() => { loadData(); }, [viewMode]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.get('/patrols/summary').then(res => res.data);
      setPatrols(data || []);
      setCheckpoints([]);
    } catch (err) {
      setError('Failed to load patrol data');
    } finally {
      setLoading(false);
    }
  };

  // Filter by date range
  const filterByDate = (items) => {
    if (!dateFrom && !dateTo) return items;
    return items.filter(item => {
      const itemDate = new Date(item.date || item.created_at || item.actual_start || item.scanned_at);
      const fromMatch = dateFrom ? itemDate >= new Date(dateFrom) : true;
      const toMatch = dateTo ? itemDate <= new Date(dateTo + 'T23:59:59') : true;
      return fromMatch && toMatch;
    });
  };

  const filteredPatrols = filterByDate(patrols);
  const filteredCheckpoints = filterByDate(checkpoints);

  // Calculate stats per guard
  const guardStats = React.useMemo(() => {
    const stats = {};

    filteredPatrols.forEach(p => {
      const guardId = p.guard_id || p.guard_name || 'Unknown';
      if (!stats[guardId]) {
        stats[guardId] = {
          guardId,
          guardName: p.guard_name || p.profiles?.full_name || 'Unknown',
          total: 0,
          acknowledged: 0,
          missing: 0,
          scanned: 0,
          missed: 0
        };
      }
      stats[guardId].total++;
      if (p.acknowledged || p.status === 'completed') {
        stats[guardId].acknowledged++;
      } else {
        stats[guardId].missing++;
      }
    });

    filteredCheckpoints.forEach(c => {
      const guardId = c.scanned_by || c.guard_id || c.guard_name || 'Unknown';
      if (!stats[guardId]) {
        stats[guardId] = {
          guardId,
          guardName: c.guard_name || c.profiles?.full_name || 'Unknown',
          total: 0,
          acknowledged: 0,
          missing: 0,
          scanned: 0,
          missed: 0
        };
      }
      if (c.scanned || c.status === 'scanned') {
        stats[guardId].scanned++;
      } else {
        stats[guardId].missed++;
      }
    });

    return Object.values(stats);
  }, [filteredPatrols, filteredCheckpoints]);

  // Overall stats
  const totalPatrols = filteredPatrols.length;
  const acknowledged = filteredPatrols.filter(p => p.acknowledged || p.status === 'completed').length;
  const missing = totalPatrols - acknowledged;
  const ackPercent = totalPatrols ? Math.round((acknowledged / totalPatrols) * 100) : 0;
  const missPercent = totalPatrols ? Math.round((missing / totalPatrols) * 100) : 0;

  const totalCheckpoints = filteredCheckpoints.length;
  const scanned = filteredCheckpoints.filter(c => c.scanned || c.status === 'scanned').length;
  const missed = totalCheckpoints - scanned;
  const scanPercent = totalCheckpoints ? Math.round((scanned / totalCheckpoints) * 100) : 0;
  const missedPercent = totalCheckpoints ? Math.round((missed / totalCheckpoints) * 100) : 0;

  // Donut Chart Component
  const DonutChart = ({ percentage, color, label, count, total, sublabel }) => {
    const size = 140;
    const strokeWidth = 12;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (percentage / 100) * circumference;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: '#0a0a0a',
        border: '1px solid #1f1f1f',
        borderRadius: 12,
        padding: '20px',
        minWidth: 160,
        flex: 1
      }}>
        <div style={{ position: 'relative', width: size, height: size, marginBottom: 12 }}>
          <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#2a2a2a"
              strokeWidth={strokeWidth}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: color }}>{percentage}%</div>
            <div style={{ fontSize: 11, color: '#666' }}>{count}/{total}</div>
          </div>
        </div>
        <span style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}>{label}</span>
        {sublabel && <span style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{sublabel}</span>}
      </div>
    );
  };

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = import.meta.env.VITE_SITE_NAME || 'Site';

    doc.setFontSize(16);
    doc.text(`Guard Patrol Dashboard - ${siteName}`, 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100);
    const dateText = dateFrom || dateTo
      ? `Period: ${dateFrom || 'All'} to ${dateTo || 'All'}`
      : `Exported: ${new Date().toLocaleString()}`;
    doc.text(dateText, 14, 28);
    doc.text(`Generated by: ${user?.name || user?.username || 'Unknown'}`, 14, 34);

    // Stats summary
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Patrol Statistics', 14, 45);
    doc.setFontSize(10);
    doc.text(`Acknowledged: ${acknowledged} (${ackPercent}%) | Missing: ${missing} (${missPercent}%)`, 14, 52);
    doc.text(`Scanned Points: ${scanned} (${scanPercent}%) | Missed Points: ${missed} (${missedPercent}%)`, 14, 58);

    // Guard summary table
    if (guardStats.length > 0) {
      doc.autoTable({
        head: [['Guard', 'Patrols Total', 'Acknowledged', 'Missing', 'Points Scanned', 'Points Missed']],
        body: guardStats.map(g => [
          g.guardName,
          g.total,
          g.acknowledged,
          g.missing,
          g.scanned,
          g.missed
        ]),
        startY: 65,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
    }

    // Detailed patrols
    if (filteredPatrols.length > 0) {
      const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 75;
      if (finalY > 160) doc.addPage();

      doc.setFontSize(12);
      doc.text('Detailed Patrol Log', 14, finalY > 160 ? 20 : finalY);

      doc.autoTable({
        head: [['Guard', 'Date/Time', 'Patrol Name', 'Location', 'Status', 'Steps']],
        body: filteredPatrols.map(p => [
          p.guard_name || p.profiles?.full_name || '-',
          new Date(p.actual_start || p.created_at).toLocaleString(),
          p.patrol_name || '-',
          'Site Patrol',
          p.status || (p.acknowledged ? 'completed' : 'pending'),
          p.steps_taken || 0
        ]),
        startY: finalY > 160 ? 25 : finalY + 5,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
    }

    // Checkpoints table
    if (filteredCheckpoints.length > 0) {
      const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 75;
      if (finalY > 160) doc.addPage();

      doc.setFontSize(12);
      doc.text('Checkpoint Scan Log', 14, finalY > 160 ? 20 : finalY);

      doc.autoTable({
        head: [['Guard', 'Date/Time', 'Checkpoint', 'Location', 'Status', 'Scanned By']],
        body: filteredCheckpoints.map(c => [
          c.guard_name || c.profiles?.full_name || '-',
          new Date(c.scanned_at || c.created_at).toLocaleString(),
          c.checkpoint_name || c.pointId || '-',
          `Lat: ${c.latitude?.toFixed(4) || '-'}, Lng: ${c.longitude?.toFixed(4) || '-'}`,
          c.status || (c.scanned ? 'scanned' : 'pending'),
          c.scanned_by ? 'Yes' : 'No'
        ]),
        startY: finalY > 160 ? 25 : finalY + 5,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
    }

    doc.save(`GuardPatrol-${user?.username || 'report'}-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div style={{ padding: '20px', color: '#fff', background: '#000', minHeight: '100vh', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}> Guard Patrol Dashboard</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#888' }}>
            {user?.role === 'guard' ? `Viewing your patrol data only` : `Viewing ${viewMode === 'own' ? 'your' : 'all guards'} data`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {user?.role === 'admin' && (
            <select
              value={viewMode}
              onChange={e => setViewMode(e.target.value)}
              style={{
                padding: '10px 14px',
                background: '#111',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer'
              }}
            >
              <option value="own">My Patrols</option>
              <option value="all">All Guards</option>
            </select>
          )}
          <button
            onClick={handleExportPDF}
            disabled={loading || (filteredPatrols.length === 0 && filteredCheckpoints.length === 0)}
            style={{
              padding: '10px 20px',
              background: (loading || (filteredPatrols.length === 0 && filteredCheckpoints.length === 0)) ? '#444' : '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: (loading || (filteredPatrols.length === 0 && filteredCheckpoints.length === 0)) ? 'not-allowed' : 'pointer'
            }}
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#666', fontSize: 13 }}>Filter by date:</span>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '10px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14 }}
        />
        <span style={{ color: '#666' }}>to</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ padding: '10px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14 }}
        />

        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            style={{
              padding: '10px 16px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#999',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16, fontSize: 14, padding: '10px 16px', background: '#450a0a', borderRadius: 8 }}>{error}</div>}

      {/* Charts Grid */}
      {!loading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 20,
          marginBottom: 32
        }}>
          <DonutChart
            percentage={ackPercent}
            color="#22c55e"
            label="Acknowledged Patrols"
            count={acknowledged}
            total={totalPatrols}
            sublabel={`${acknowledged} of ${totalPatrols} patrols`}
          />
          <DonutChart
            percentage={missPercent}
            color="#ef4444"
            label="Missing Patrols"
            count={missing}
            total={totalPatrols}
            sublabel={`${missing} of ${totalPatrols} patrols`}
          />
          <DonutChart
            percentage={scanPercent}
            color="#3b82f6"
            label="Scanned Checkpoints"
            count={scanned}
            total={totalCheckpoints}
            sublabel={`${scanned} of ${totalCheckpoints} points`}
          />
          <DonutChart
            percentage={missedPercent}
            color="#f59e0b"
            label="Missed Checkpoints"
            count={missed}
            total={totalCheckpoints}
            sublabel={`${missed} of ${totalCheckpoints} points`}
          />
        </div>
      )}

      {/* Guard Stats Summary (for admin view) */}
      {user?.role === 'admin' && guardStats.length > 1 && !loading && (
        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20, marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}> Guard Performance Summary</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                  <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Guard</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#888' }}>Total Patrols</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#888' }}>Acknowledged</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#888' }}>Missing</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#888' }}>Points Scanned</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#888' }}>Points Missed</th>
                </tr>
              </thead>
              <tbody>
                {guardStats.map((g, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '10px', fontWeight: 600 }}>{g.guardName}</td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>{g.total}</td>
                    <td style={{ padding: '10px', textAlign: 'center', color: '#22c55e' }}>{g.acknowledged}</td>
                    <td style={{ padding: '10px', textAlign: 'center', color: '#ef4444' }}>{g.missing}</td>
                    <td style={{ padding: '10px', textAlign: 'center', color: '#3b82f6' }}>{g.scanned}</td>
                    <td style={{ padding: '10px', textAlign: 'center', color: '#f59e0b' }}>{g.missed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Tables */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>Loading patrol data...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Patrols List */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#22c55e' }}>?</span> Patrols ({filteredPatrols.length})
            </h3>

            {filteredPatrols.length === 0 ? (
              <p style={{ color: '#666', textAlign: 'center', padding: 20 }}>No patrols found</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {filteredPatrols.map((patrol, idx) => {
                  const isAck = patrol.acknowledged || patrol.status === 'completed';
                  const guardName = patrol.guard_name || patrol.profiles?.full_name || 'Unknown';
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '12px 16px',
                        background: '#111',
                        borderRadius: 8,
                        borderLeft: `4px solid ${isAck ? '#22c55e' : '#ef4444'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{guardName}</span>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: 12,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isAck ? '#166534' : '#7f1d1d',
                          color: isAck ? '#86efac' : '#fca5a5'
                        }}>
                          {isAck ? '? ACK' : '? MISS'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                        {patrol.patrol_name || 'Unnamed Patrol'}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#666' }}>
                        <span> {new Date(patrol.actual_start || patrol.created_at).toLocaleDateString()}</span>
                        <span> Steps: {patrol.steps_taken || 0}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Checkpoints List */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#3b82f6' }}>?</span> Checkpoints ({filteredCheckpoints.length})
            </h3>

            {filteredCheckpoints.length === 0 ? (
              <p style={{ color: '#666', textAlign: 'center', padding: 20 }}>No checkpoints found</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {filteredCheckpoints.map((checkpoint, idx) => {
                  const isScanned = checkpoint.scanned || checkpoint.status === 'scanned';
                  const guardName = checkpoint.guard_name || checkpoint.profiles?.full_name || 'Unknown';
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '12px 16px',
                        background: '#111',
                        borderRadius: 8,
                        borderLeft: `4px solid ${isScanned ? '#3b82f6' : '#f59e0b'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{checkpoint.checkpoint_name || `Point ${checkpoint.pointId || idx + 1}`}</span>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: 12,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isScanned ? '#1e40af' : '#713f12',
                          color: isScanned ? '#93c5fd' : '#fcd34d'
                        }}>
                          {isScanned ? '? SCAN' : '? MISS'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                        Guard: {guardName}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#666' }}>
                        <span> {checkpoint.latitude?.toFixed(4) || '-'}, {checkpoint.longitude?.toFixed(4) || '-'}</span>
                        <span> {new Date(checkpoint.scanned_at || checkpoint.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
