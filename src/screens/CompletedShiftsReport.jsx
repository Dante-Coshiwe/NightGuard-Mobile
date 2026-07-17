import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import ReportEmailPanel from '../components/ReportEmailPanel';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { getCompletedShifts } from '../services/api';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { logApiError, logApiAttempt, logApiSuccess, logOfflineUsage } from '../lib/apiErrorLogger';

export default function CompletedShiftsReport() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterName, setFilterName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadShifts();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      console.log('[CompletedShiftsReport] Coming online - reloading shifts from server');
      loadShifts();
    };
    window.addEventListener('nightguard_sync_complete', handleOnline);
    window.addEventListener('online', handleOnline);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    return () => {
      window.removeEventListener('nightguard_sync_complete', handleOnline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, []);

  const loadShifts = async () => {
    setLoading(true);
    setError('');
    try {
      logApiAttempt('CompletedShiftsReport', 'GET', '/shifts/completed');
      const data = await getCompletedShifts();
      logApiSuccess('CompletedShiftsReport', 'GET', '/shifts/completed', data?.length || 0);
      setShifts(data || []);
    } catch (err) {
      const details = logApiError(navigator.onLine, err, 'CompletedShiftsReport');

      // Fallback to offline message but keep UI functional
      if (!navigator.onLine) {
        setError('Unable to load shifts while offline. Please check your connection.');
      } else {
        setError(`Failed to load shifts: ${details.errorMsg}`);
      }
      setShifts([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (hours, minutes) => {
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  };

  const filtered = shifts.filter((shift) => {
    const nameMatch = String(shift.guard_name || '').toLowerCase().includes(filterName.toLowerCase());
    const start = new Date(shift.started_at);
    const fromMatch = dateFrom ? start >= new Date(dateFrom) : true;
    const toMatch = dateTo ? start <= new Date(`${dateTo}T23:59:59`) : true;
    return nameMatch && fromMatch && toMatch;
  });

  const handleExportPDF = async (shareOptions = {}) => {
    setExporting(true);
    setError('');

    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getSiteDisplayName();
    doc.setFontSize(14);
    doc.text(`Completed Shifts - ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 14, 23);
    doc.autoTable({
      head: [['Guard', 'Start', 'End', 'Duration', 'Sunday']],
      body: filtered.map((shift) => [
        shift.guard_name,
        formatDateTime(shift.started_at),
        formatDateTime(shift.ended_at),
        formatDuration(shift.duration_hours, shift.duration_minutes),
        shift.is_sunday ? 'Yes' : 'No',
      ]),
      startY: 27,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    try {
      await exportPdfDocument(doc, buildDatedReportFileName('Shifts'), {
        shareTitle: 'Completed Shifts Report',
        shareText: 'NightGuard completed shifts report PDF.',
        ...shareOptions,
      });
    } catch (err) {
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: '20px', color: '#fff', background: '#000', minHeight: '100vh', boxSizing: 'border-box' }}>
      <ReportEmailPanel
        reportKey="completed-shifts"
        reportLabel="Completed Shifts"
        onShareReport={({ recipients, subject, body, senderEmail }) => handleExportPDF({
          preferShare: true,
          shareTitle: subject,
          shareText: `${body}\n\nRecipients: ${recipients}\nSender account: ${senderEmail}`,
        })}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Completed Shifts</h1>
        <button
          onClick={() => handleExportPDF()}
          disabled={filtered.length === 0 || exporting}
          style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: filtered.length === 0 || exporting ? 0.5 : 1 }}
        >
          {exporting ? 'Preparing PDF...' : 'Export PDF'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter by name..."
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          style={{ flex: 1, minWidth: 120, padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{ padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13 }}
        />
        {(filterName || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setFilterName('');
              setDateFrom('');
              setDateTo('');
            }}
            style={{ padding: '7px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#999', fontSize: 13, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {!loading && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Total: </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{filtered.length} shifts</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Sundays: </span>
            <span style={{ color: '#fca5a5', fontWeight: 600 }}>{filtered.filter((shift) => shift.is_sunday).length}</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Total hours: </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {Math.floor(filtered.reduce((acc, shift) => acc + (shift.duration_ms || 0), 0) / 3600000)}h
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading shifts...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>No completed shifts found</div>
      ) : (
        <div>
          {filtered.map((shift) => (
            <div key={shift.id} style={{ background: shift.is_sunday ? '#150a0a' : '#0a0a0a', border: `1px solid ${shift.is_sunday ? '#7f1d1d' : '#1f1f1f'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{shift.guard_name}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {shift.is_sunday && <span style={{ background: '#7f1d1d', color: '#fca5a5', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>Sunday</span>}
                  <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 13 }}>{formatDuration(shift.duration_hours, shift.duration_minutes)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>Start</div>
                  <div style={{ color: '#ccc', fontSize: 13 }}>{formatDateTime(shift.started_at)}</div>
                </div>
                <div>
                  <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>End</div>
                  <div style={{ color: '#ccc', fontSize: 13 }}>{formatDateTime(shift.ended_at)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
