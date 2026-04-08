import React, { useState, useEffect } from 'react';
import { getCompletedShifts } from '../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

export default function CompletedShiftsReport() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterName, setFilterName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => { loadShifts(); }, []);

  const loadShifts = async () => {
    setLoading(true);
    try {
      const data = await getCompletedShifts();
      setShifts(data || []);
    } catch (err) {
      setError('Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (ts) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const formatDuration = (hours, minutes) => {
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  };

  const filtered = shifts.filter(s => {
    const nameMatch = s.guard_name.toLowerCase().includes(filterName.toLowerCase());
    const start = new Date(s.started_at);
    const fromMatch = dateFrom ? start >= new Date(dateFrom) : true;
    const toMatch = dateTo ? start <= new Date(dateTo + 'T23:59:59') : true;
    return nameMatch && fromMatch && toMatch;
  });

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = import.meta.env.VITE_SITE_NAME || 'UNKNOWN SITE';
    doc.setFontSize(14);
    doc.text(`Completed Shifts - ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 14, 23);
    doc.autoTable({
      head: [['Guard', 'Start', 'End', 'Duration', 'Sunday']],
      body: filtered.map(s => [
        s.guard_name,
        formatDateTime(s.started_at),
        formatDateTime(s.ended_at),
        formatDuration(s.duration_hours, s.duration_minutes),
        s.is_sunday ? 'Yes' : 'No',
      ]),
      startY: 27,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });
    doc.save(`Shifts-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div style={{ padding: '20px', color: '#fff', background: '#000', minHeight: '100vh', boxSizing: 'border-box' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Completed Shifts</h1>
        <button
          onClick={handleExportPDF}
          disabled={filtered.length === 0}
          style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: filtered.length === 0 ? 0.5 : 1 }}
        >
          Export PDF
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter by name..."
          value={filterName}
          onChange={e => setFilterName(e.target.value)}
          style={{ flex: 1, minWidth: 120, padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
        {(filterName || dateFrom || dateTo) && (
          <button onClick={() => { setFilterName(''); setDateFrom(''); setDateTo(''); }}
            style={{ padding: '7px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#999', fontSize: 13, cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Summary bar */}
      {!loading && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Total: </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{filtered.length} shifts</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Sundays: </span>
            <span style={{ color: '#fca5a5', fontWeight: 600 }}>{filtered.filter(s => s.is_sunday).length}</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Total hours: </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {Math.floor(filtered.reduce((acc, s) => acc + (s.duration_ms || 0), 0) / 3600000)}h
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading shifts...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>No completed shifts found</div>
      ) : (
        <>
          {/* Desktop table */}
          <div style={{ display: 'none' }} className="desktop-table">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                  {['Guard', 'Start', 'End', 'Duration', 'Day'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#666', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #111', background: s.is_sunday ? '#150a0a' : 'transparent' }}>
                    <td style={{ padding: '10px', color: '#fff', fontWeight: 600 }}>{s.guard_name}</td>
                    <td style={{ padding: '10px', color: '#ccc' }}>{formatDateTime(s.started_at)}</td>
                    <td style={{ padding: '10px', color: '#ccc' }}>{formatDateTime(s.ended_at)}</td>
                    <td style={{ padding: '10px', color: '#ccc' }}>{formatDuration(s.duration_hours, s.duration_minutes)}</td>
                    <td style={{ padding: '10px' }}>
                      {s.is_sunday
                        ? <span style={{ background: '#7f1d1d', color: '#fca5a5', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>Sun</span>
                        : <span style={{ color: '#444', fontSize: 11 }}>{new Date(s.started_at).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div>
            {filtered.map(s => (
              <div key={s.id} style={{ background: s.is_sunday ? '#150a0a' : '#0a0a0a', border: `1px solid ${s.is_sunday ? '#7f1d1d' : '#1f1f1f'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{s.guard_name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {s.is_sunday && <span style={{ background: '#7f1d1d', color: '#fca5a5', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>Sunday</span>}
                    <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 13 }}>{formatDuration(s.duration_hours, s.duration_minutes)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>Start</div>
                    <div style={{ color: '#ccc', fontSize: 13 }}>{formatDateTime(s.started_at)}</div>
                  </div>
                  <div>
                    <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>End</div>
                    <div style={{ color: '#ccc', fontSize: 13 }}>{formatDateTime(s.ended_at)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}