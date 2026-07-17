import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import ReportEmailPanel from '../components/ReportEmailPanel';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { getCachedPedestrians } from '../lib/deviceStore';
import { getPedestrianReport } from '../services/api';
import { logApiError, logApiAttempt, logApiSuccess, logOfflineUsage } from '../lib/apiErrorLogger';

export default function PedestrianReport() {
  const [hourly, setHourly] = useState([]);
  const [neverLeft, setNeverLeft] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dataSource, setDataSource] = useState(''); // Track where data came from

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      console.log('[PedestrianReport] Coming online - reloading pedestrian report from server');
      loadData();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, []);

  const getCachedPedestrianRows = () => getCachedPedestrians().map((person) => ({
    id: person.id,
    full_name: person.name,
    contact_number: person.contact,
    purpose_of_visit: person.visitorType,
    visiting_unit: person.unitVisiting,
    host_name: person.hostName,
    picture_url: person.photoUrl,
    entry_time: person.entryTime,
    exit_time: person.exitTime,
    _offline: person._offline,
    _pendingExit: person._pendingExit,
  }));

  const mergeServerAndCachedRows = (serverRows) => {
    const cachedRows = getCachedPedestrianRows();
    const serverIds = new Set((serverRows || []).map((person) => String(person?.id)));
    const cachedOnlyRows = cachedRows.filter((person) => !serverIds.has(String(person?.id)));
    return [...cachedOnlyRows, ...(serverRows || [])];
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    let pedestrians = [];
    let source = 'offline-cache';

    try {
      logApiAttempt('PedestrianReport', 'GET', '/pedestrians/report');
      const apiData = await getPedestrianReport();
      if (Array.isArray(apiData)) {
        pedestrians = mergeServerAndCachedRows(apiData);
        source = pedestrians.some((person) => person?._offline || person?._pendingExit) ? 'server+cache' : 'server';
        logApiSuccess('PedestrianReport', 'GET', '/pedestrians/report', pedestrians.length);
      } else {
        throw new Error('Invalid response from API');
      }
    } catch (apiError) {
      logApiError(navigator.onLine, apiError, 'PedestrianReport');
      logOfflineUsage('PedestrianReport', 'offline cache');

      pedestrians = getCachedPedestrianRows();
    }

    setDataSource(source);

    if (pedestrians.length === 0) {
      setError('No pedestrian data available');
      console.warn(`[PedestrianReport] No data available from either source`);
    } else {
      const openPedestrians = pedestrians.filter((person) => !person.exit_time);
      const buckets = {};
      
      for (const person of pedestrians) {
        const hourKey = new Date(person.entry_time);
        hourKey.setMinutes(0, 0, 0);
        const key = hourKey.toISOString();

        if (!buckets[key]) {
          buckets[key] = { hour: key, entered: 0, exited: 0, inside: 0 };
        }
        buckets[key].entered += 1;
        if (person.exit_time) buckets[key].exited += 1;
        else buckets[key].inside += 1;
      }

      setHourly(Object.values(buckets).sort((a, b) => new Date(b.hour) - new Date(a.hour)));
      setNeverLeft(openPedestrians);
      setTotal(pedestrians.length);
    }

    setLoading(false);
  };

  const filtered = hourly.filter((row) => {
    const date = new Date(row.hour);
    const fromMatch = dateFrom ? date >= new Date(dateFrom) : true;
    const toMatch = dateTo ? date <= new Date(`${dateTo}T23:59:59`) : true;
    return fromMatch && toMatch;
  });

  const formatHour = (timestamp) => new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
  });

  const totalEntered = filtered.reduce((acc, row) => acc + row.entered, 0);
  const totalInside = neverLeft.length;

  const buildPdfDocument = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getSiteDisplayName();

    doc.setFontSize(14);
    doc.text(`Pedestrian Report - ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()} | Total pedestrians: ${total}`, 14, 23);

    doc.autoTable({
      head: [['Hour', 'Entered', 'Exited', 'Inside']],
      body: filtered.map((row) => [formatHour(row.hour), row.entered, row.exited, row.inside]),
      startY: 28,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    if (neverLeft.length > 0) {
      const finalY = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('Pedestrians Still Inside', 14, finalY);
      doc.autoTable({
        head: [['Name', 'Contact', 'Purpose', 'Unit', 'Host', 'Entry Time']],
        body: neverLeft.map((person) => [
          person.full_name || '-',
          person.contact_number || '-',
          person.purpose_of_visit || '-',
          person.visiting_unit || '-',
          person.host_name || '-',
          new Date(person.entry_time).toLocaleString(),
        ]),
        startY: finalY + 5,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [239, 68, 68], textColor: 255 },
      });
    }

    return doc;
  };

  const handleExportPDF = async (shareOptions = {}) => {
    setExporting(true);
    setError('');
    try {
      await exportPdfDocument(buildPdfDocument(), buildDatedReportFileName('PedestrianReport'), {
        shareTitle: 'Pedestrian Report',
        shareText: 'NightGuard pedestrian report PDF.',
        ...shareOptions,
      });
    } catch (err) {
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: 20, background: '#000', minHeight: '100vh', color: '#fff' }}>
      <ReportEmailPanel
        reportKey="pedestrian-report"
        reportLabel="Pedestrian Report"
        onShareReport={({ recipients, subject, body, senderEmail }) => handleExportPDF({
          preferShare: true,
          shareTitle: subject,
          shareText: `${body}\n\nRecipients: ${recipients}\nSender account: ${senderEmail}`,
        })}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Pedestrian Report</h1>
        <button
          onClick={() => handleExportPDF()}
          disabled={filtered.length === 0 || exporting}
          style={{
            padding: '8px 16px',
            background: filtered.length === 0 || exporting ? '#444' : '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: filtered.length === 0 || exporting ? 'not-allowed' : 'pointer',
          }}
        >
          {exporting ? 'Preparing PDF...' : 'Export PDF'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            style={{ padding: '7px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#999', fontSize: 13, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Total Entered: </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{totalEntered}</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#f87171' }}>Still Inside: </span>
            <span style={{ color: '#f87171', fontWeight: 600 }}>{totalInside}</span>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
            <span style={{ color: '#666' }}>All Time Total: </span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{total}</span>
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
            filtered.map((row, index) => (
              <div key={index} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 600, color: '#fff' }}>{formatHour(row.hour)}</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ color: '#22c55e' }}>In {row.entered}</span>
                  <span style={{ color: '#60a5fa' }}>Out {row.exited}</span>
                  <span style={{ color: '#f87171' }}>Inside {row.inside}</span>
                </div>
              </div>
            ))
          )}

          {neverLeft.length > 0 && (
            <>
              <h2 style={{ fontSize: 15, color: '#f87171', marginTop: 24, marginBottom: 12 }}>Pedestrians Still Inside ({neverLeft.length})</h2>
              {neverLeft.map((person, index) => (
                <div key={index} style={{ background: '#150a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '12px 16px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{person.full_name || 'Unknown'}</span>
                    <span style={{ color: '#f87171', fontSize: 12 }}>{new Date(person.entry_time).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#ccc' }}>
                    <span>Contact: {person.contact_number || '-'}</span>
                    <span>Purpose: {person.purpose_of_visit || '-'}</span>
                    <span>Unit: {person.visiting_unit || '-'}</span>
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
