import React, { useEffect, useMemo, useState } from 'react';
import { getCompletedShifts } from '../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import ReportEmailPanel from '../components/ReportEmailPanel';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { logApiError, logApiAttempt, logApiSuccess } from '../lib/apiErrorLogger';

export default function ShiftSummaryReport() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        logApiAttempt('ShiftSummaryReport', 'GET', '/shifts/completed');
        const data = await getCompletedShifts();
        logApiSuccess('ShiftSummaryReport', 'GET', '/shifts/completed', data?.length || 0);
        setShifts(data || []);
      } catch (err) {
        const details = logApiError(navigator.onLine, err, 'ShiftSummaryReport');
        setError(`Failed to load shift summary: ${details.errorMsg}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const summary = useMemo(() => {
    const grouped = {};
    shifts.forEach((shift) => {
      const key = shift.guard_name || 'Unknown';
      if (!grouped[key]) {
        grouped[key] = { name: key, shifts: 0, minutes: 0, sundays: 0 };
      }
      grouped[key].shifts += 1;
      grouped[key].minutes += (shift.duration_hours || 0) * 60 + (shift.duration_minutes || 0);
      if (shift.is_sunday) grouped[key].sundays += 1;
    });
    return Object.values(grouped);
  }, [shifts]);

  const handleExportPDF = async (shareOptions = {}) => {
    setExporting(true);
    setError('');
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getSiteDisplayName();
    doc.setFontSize(14);
    doc.text(`Shift Summary Report - ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 14, 23);
    doc.autoTable({
      head: [['Guard', 'Shifts', 'Total Time', 'Sundays']],
      body: summary.map((item) => [
        item.name,
        item.shifts,
        `${Math.floor(item.minutes / 60)}h ${item.minutes % 60}m`,
        item.sundays,
      ]),
      startY: 27,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });
    try {
      await exportPdfDocument(doc, buildDatedReportFileName('ShiftSummary'), {
        shareTitle: 'Shift Summary Report',
        shareText: 'NightGuard shift summary report PDF.',
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
        reportKey="shift-summary-report"
        reportLabel="Shift Summary Report"
        onShareReport={({ recipients, subject, body, senderEmail }) => handleExportPDF({
          preferShare: true,
          shareTitle: subject,
          shareText: `${body}\n\nRecipients: ${recipients}\nSender account: ${senderEmail}`,
        })}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Shift Summary Report</h1>
          <p style={{ margin: '4px 0 0', color: '#8b8b8b', fontSize: 13 }}>Guard-by-guard summary of completed shifts.</p>
        </div>
        <button
          onClick={() => handleExportPDF()}
          disabled={summary.length === 0 || exporting}
          style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: summary.length === 0 || exporting ? 0.5 : 1 }}
        >
          {exporting ? 'Preparing PDF...' : 'Export PDF'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading summary...</div>
      ) : summary.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>No shift data available.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {summary.map((item) => (
            <div key={item.name} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{item.name}</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#d4d4d8', fontSize: 14 }}>
                <span>Shifts: {item.shifts}</span>
                <span>Total time: {Math.floor(item.minutes / 60)}h {item.minutes % 60}m</span>
                <span>Sundays: {item.sundays}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
