import React, { useState, useEffect } from 'react';
import { getVehicleReport } from '../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

export default function VehicleReport() {
  const [hourly, setHourly] = useState([]);
  const [neverLeft, setNeverLeft] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getVehicleReport();
      setHourly(res.hourly || []);
      setNeverLeft(res.never_left || []);
      setTotal(res.total || 0);
    } catch {
      setError('Failed to load vehicle report');
    } finally {
      setLoading(false);
    }
  };

  const filtered = hourly.filter(d => {
    const date = new Date(d.hour);
    const fromMatch = dateFrom ? date >= new Date(dateFrom) : true;
    const toMatch = dateTo ? date <= new Date(dateTo + 'T23:59:59') : true;
    return fromMatch && toMatch;
  });

  const formatHour = (ts) => new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit'
  });

  const totalEntered = filtered.reduce((a, b) => a + b.entered, 0);
  const totalInside = neverLeft.length;

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = import.meta.env.VITE_SITE_NAME || 'UNKNOWN SITE';

    doc.setFontSize(14);
    doc.text(`Vehicle Report - ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()} | Total vehicles: ${total}`, 14, 23);

    doc.autoTable({
      head: [['Hour', 'Entered', 'Exited', 'Inside']],
      body: filtered.map(d => [formatHour(d.hour), d.entered, d.exited, d.inside]),
      startY: 28,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    if (neverLeft.length > 0) {
      const finalY = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('Vehicles Still Inside', 14, finalY);
      doc.autoTable({
        head: [['License Plate', 'Driver', 'Make', 'Color', 'Unit', 'Entry Time']],
        body: neverLeft.map(v => [
          v.license_plate || '-',
          v.driver_name || '-',
          v.vehicle_make || '-',
          v.vehicle_color || '-',
          v.visiting_unit || '-',
          new Date(v.entered_at).toLocaleString(),
        ]),
        startY: finalY + 5,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [239, 68, 68], textColor: 255 },
      });
    }

    doc.save(`VehicleReport-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div style={{ padding: 20, background: '#000', minHeight: '100vh', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Vehicle Report</h1>
        <button onClick={handleExportPDF} disabled={filtered.length === 0}
          style={{ padding: '8px 16px', background: filtered.length === 0 ? '#444' : '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Export PDF
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }} />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }}
            style={{ padding: '7px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#999', fontSize: 13, cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Total Entered: </span><span style={{ color: '#fff', fontWeight: 600 }}>{totalEntered}</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#f87171' }}>Still Inside: </span><span style={{ color: '#f87171', fontWeight: 600 }}>{totalInside}</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>All Time Total: </span><span style={{ color: '#fff', fontWeight: 600 }}>{total}</span>
          </div>
        </div>
      )}

      {error && <div style={{ color: '#ef4444', marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading...</div>
      ) : (
        <>
          <h2 style={{ fontSize: 15, color: '#fff', marginBottom: 12 }}>Hourly Breakdown</h2>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>No data for selected period</div>
          ) : (
            filtered.map((d, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 600, color: '#fff' }}>{formatHour(d.hour)}</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ color: '#22c55e' }}>↑ {d.entered} in</span>
                  <span style={{ color: '#60a5fa' }}>↓ {d.exited} out</span>
                  <span style={{ color: '#f87171' }}>⬤ {d.inside} inside</span>
                </div>
              </div>
            ))
          )}

          {neverLeft.length > 0 && (
            <>
              <h2 style={{ fontSize: 15, color: '#f87171', marginTop: 24, marginBottom: 12 }}>⚠ Vehicles Still Inside ({neverLeft.length})</h2>
              {neverLeft.map((v, i) => (
                <div key={i} style={{ background: '#150a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '12px 16px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{v.license_plate || 'Unknown'}</span>
                    <span style={{ color: '#f87171', fontSize: 12 }}>{new Date(v.entered_at).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#ccc' }}>
                    <span>Driver: {v.driver_name || '-'}</span>
                    <span>{v.vehicle_make || ''} {v.vehicle_color || ''}</span>
                    <span>Unit: {v.visiting_unit || '-'}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}