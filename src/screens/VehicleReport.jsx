import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import ReportEmailPanel from '../components/ReportEmailPanel';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { getCachedVehicles } from '../lib/deviceStore';
import { getVehicleReport } from '../services/api';
import { logApiError, logApiAttempt, logApiSuccess, logOfflineUsage } from '../lib/apiErrorLogger';

export default function VehicleReport() {
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
      console.log('[VehicleReport] Coming online - reloading vehicle report from server');
      loadData();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, []);

  const getCachedVehicleRows = () => getCachedVehicles().map((vehicle) => ({
    id: vehicle.id,
    license_plate: vehicle.licensePlate,
    driver_name: vehicle.driverName,
    vehicle_make: vehicle.makeModel,
    vehicle_color: vehicle.colour,
    visiting_unit: vehicle.personVisiting,
    picture_url: vehicle.photoUrl,
    entered_at: vehicle.enteredAt,
    exited_at: vehicle.exitedAt,
    _offline: vehicle._offline,
    _pendingExit: vehicle._pendingExit,
  }));

  const mergeServerAndCachedRows = (serverRows) => {
    const cachedRows = getCachedVehicleRows();
    const serverIds = new Set((serverRows || []).map((vehicle) => String(vehicle?.id)));
    const cachedOnlyRows = cachedRows.filter((vehicle) => !serverIds.has(String(vehicle?.id)));
    return [...cachedOnlyRows, ...(serverRows || [])];
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    let vehicles = [];
    let source = 'offline-cache';

    try {
      logApiAttempt('VehicleReport', 'GET', '/vehicles/report');
      const apiData = await getVehicleReport();
      if (Array.isArray(apiData)) {
        vehicles = mergeServerAndCachedRows(apiData);
        source = vehicles.some((vehicle) => vehicle?._offline || vehicle?._pendingExit) ? 'server+cache' : 'server';
        logApiSuccess('VehicleReport', 'GET', '/vehicles/report', vehicles.length);
      } else {
        throw new Error('Invalid response from API');
      }
    } catch (apiError) {
      logApiError(navigator.onLine, apiError, 'VehicleReport');
      logOfflineUsage('VehicleReport', 'offline cache');

      vehicles = getCachedVehicleRows();
    }

    setDataSource(source);

    if (vehicles.length === 0) {
      setError('No vehicle data available');
      console.warn(`[VehicleReport] No data available from either source`);
    } else {
      const activeVehicles = vehicles.filter((vehicle) => !vehicle.exited_at);
      const buckets = {};
      
      for (const vehicle of vehicles) {
        const hourKey = new Date(vehicle.entered_at);
        hourKey.setMinutes(0, 0, 0);
        const key = hourKey.toISOString();

        if (!buckets[key]) {
          buckets[key] = { hour: key, entered: 0, exited: 0, inside: 0 };
        }
        buckets[key].entered += 1;
        if (vehicle.exited_at) buckets[key].exited += 1;
        else buckets[key].inside += 1;
      }

      setHourly(Object.values(buckets).sort((a, b) => new Date(b.hour) - new Date(a.hour)));
      setNeverLeft(activeVehicles);
      setTotal(vehicles.length);
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
    doc.text(`Vehicle Report - ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()} | Total vehicles: ${total}`, 14, 23);

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
      doc.text('Vehicles Still Inside', 14, finalY);
      doc.autoTable({
        head: [['License Plate', 'Driver', 'Make', 'Color', 'Unit', 'Entry Time']],
        body: neverLeft.map((vehicle) => [
          vehicle.license_plate || '-',
          vehicle.driver_name || '-',
          vehicle.vehicle_make || '-',
          vehicle.vehicle_color || '-',
          vehicle.visiting_unit || '-',
          new Date(vehicle.entered_at).toLocaleString(),
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
      await exportPdfDocument(buildPdfDocument(), buildDatedReportFileName('VehicleReport'), {
        shareTitle: 'Vehicle Report',
        shareText: 'NightGuard vehicle report PDF.',
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
        reportKey="vehicle-report"
        reportLabel="Vehicle Report"
        onShareReport={({ recipients, subject, body, senderEmail }) => handleExportPDF({
          preferShare: true,
          shareTitle: subject,
          shareText: `${body}\n\nRecipients: ${recipients}\nSender account: ${senderEmail}`,
        })}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Vehicle Report</h1>
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
              <h2 style={{ fontSize: 15, color: '#f87171', marginTop: 24, marginBottom: 12 }}>Vehicles Still Inside ({neverLeft.length})</h2>
              {neverLeft.map((vehicle, index) => (
                <div key={index} style={{ background: '#150a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '12px 16px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{vehicle.license_plate || 'Unknown'}</span>
                    <span style={{ color: '#f87171', fontSize: 12 }}>{new Date(vehicle.entered_at).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#ccc' }}>
                    <span>Driver: {vehicle.driver_name || '-'}</span>
                    <span>{vehicle.vehicle_make || ''} {vehicle.vehicle_color || ''}</span>
                    <span>Unit: {vehicle.visiting_unit || '-'}</span>
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
