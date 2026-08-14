import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  BarList,
  DataFreshness,
  DateRangeFilter,
  EmptyState,
  KpiRow,
  Panel,
  ReportHeader,
  ShareButton,
  StatTile,
  StatusPill,
} from '../components/ReportKit';
import { REPORT_COLORS, reportPageStyle } from '../lib/reportTheme';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { getCachedVehicles, getLastSyncAt } from '../lib/deviceStore';
import { getVehicleReport } from '../services/api';
import { logApiError, logApiAttempt, logApiSuccess, logOfflineUsage } from '../lib/apiErrorLogger';

// ============================================================================
//  Vehicle Report — gate traffic, and it has to open with no signal.
//
//  Offline it used to run the Supabase query anyway, throw, and fall back to
//  whatever this handset had typed itself — usually nothing, so the page showed a
//  red "No vehicle data available" as if something had broken. `listVehicles` now
//  answers from the cache when offline and refills that cache on every online read,
//  so this screen has something real to render either way. What is left here is
//  making the page HONEST about which of the two it is showing.
//
//  The tiles also disagreed with each other: "Total Entered" respected the date
//  filter while "Still Inside" and "All Time Total" ignored it, so filtering to
//  yesterday showed 3 in and 40 inside. Every number below is filtered except the
//  one that is meaningless filtered — on-site right now — which says so.
// ============================================================================

// The cache speaks VehicleTab's camelCase; this report speaks the server's snake_case.
function cachedRows() {
  return getCachedVehicles().map((vehicle) => ({
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
}

// No setState in here on purpose — see the effect below.
async function fetchVehiclesSafely() {
  const loadedAt = new Date().toISOString();
  try {
    logApiAttempt('VehicleReport', 'GET', '/vehicles/report');
    const rows = await getVehicleReport();
    if (!Array.isArray(rows)) throw new Error('Unexpected response shape');

    // Anything this handset holds that the server has not confirmed yet (queued
    // entry, exit tapped offline) belongs in the report too — it happened.
    const serverIds = new Set(rows.map((vehicle) => String(vehicle?.id)));
    const localOnly = cachedRows().filter((vehicle) => !serverIds.has(String(vehicle?.id)));

    logApiSuccess('VehicleReport', 'GET', '/vehicles/report', rows.length + localOnly.length);
    return { rows: [...localOnly, ...rows], fromCache: !navigator.onLine, error: '', loadedAt };
  } catch (apiError) {
    logApiError(navigator.onLine, apiError, 'VehicleReport');
    logOfflineUsage('VehicleReport', 'offline cache');
    return {
      rows: cachedRows(),
      fromCache: true,
      // Online AND failing is a real fault worth naming; offline is not — offline is
      // the expected condition on a gate phone, and the freshness line already says so.
      error: navigator.onLine ? 'Could not reach the server — showing what is saved on this device.' : '',
      loadedAt,
    };
  }
}

export default function VehicleReport() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      const result = await fetchVehiclesSafely();
      if (!active) return;
      setVehicles(result.rows);
      setServedFromCache(result.fromCache);
      setError(result.error);
      setLoadedAt(result.loadedAt);
      setLoading(false);
    };

    run();
    window.addEventListener('nightguard_sync_complete', run);
    window.addEventListener('online', run);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, run);
    return () => {
      active = false;
      window.removeEventListener('nightguard_sync_complete', run);
      window.removeEventListener('online', run);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, run);
    };
  }, []);

  const inPeriod = useMemo(() => {
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
    return vehicles.filter((vehicle) => {
      const entered = new Date(vehicle.entered_at || 0).getTime();
      if (!Number.isFinite(entered) || !entered) return false;
      if (fromTime && entered < fromTime) return false;
      if (toTime && entered > toTime) return false;
      return true;
    });
  }, [vehicles, dateFrom, dateTo]);

  // Deliberately NOT filtered by date: "on site right now" is a live count, and a
  // vehicle that drove in last Tuesday and never left is exactly the one a guard
  // needs to see. Labelled so the difference is obvious rather than a trap.
  const onSiteNow = useMemo(() => (
    vehicles
      .filter((vehicle) => !vehicle.exited_at)
      .sort((a, b) => new Date(a.entered_at || 0) - new Date(b.entered_at || 0))
  ), [vehicles]);

  const hourly = useMemo(() => {
    const buckets = new Map();
    inPeriod.forEach((vehicle) => {
      const stamp = new Date(vehicle.entered_at);
      stamp.setMinutes(0, 0, 0);
      const key = stamp.toISOString();
      if (!buckets.has(key)) buckets.set(key, { hour: key, entered: 0, exited: 0, stillIn: 0 });
      const bucket = buckets.get(key);
      bucket.entered += 1;
      if (vehicle.exited_at) bucket.exited += 1;
      else bucket.stillIn += 1;
    });
    return [...buckets.values()].sort((a, b) => new Date(b.hour) - new Date(a.hour));
  }, [inPeriod]);

  // "On site for" is measured from when this page last loaded, not from a live clock.
  // Reading Date.now() during render makes the component non-idempotent — the same
  // props would render different text on every re-render — which React's rules of
  // purity forbid. `loadedAt` is always set by the time the list renders.
  const asOf = loadedAt ? new Date(loadedAt).getTime() : 0;
  const exitedInPeriod = inPeriod.filter((vehicle) => vehicle.exited_at).length;
  const pendingSync = vehicles.filter((vehicle) => vehicle._offline || vehicle._pendingExit).length;
  const periodLabel = dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : 'All time';

  const averageStayMs = useMemo(() => {
    const completed = inPeriod.filter((vehicle) => vehicle.exited_at && vehicle.entered_at);
    if (!completed.length) return 0;
    const total = completed.reduce((acc, vehicle) => (
      acc + Math.max(0, new Date(vehicle.exited_at) - new Date(vehicle.entered_at))
    ), 0);
    return total / completed.length;
  }, [inPeriod]);

  const formatHour = (timestamp) => new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit',
  });

  const formatStay = (ms) => {
    if (!ms) return '—';
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  };

  const handleSharePDF = async () => {
    setExporting(true);
    setError('');
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      const siteName = getSiteDisplayName();

      doc.setFontSize(14);
      doc.text(`Vehicle Report — ${siteName}`, 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Period: ${periodLabel}   |   Exported: ${new Date().toLocaleString()}`, 14, 22);
      doc.text(
        `${inPeriod.length} entered · ${exitedInPeriod} left · ${onSiteNow.length} on site now · average stay ${formatStay(averageStayMs)}`
        + (servedFromCache ? '   |   Prepared offline from data saved on this device' : ''),
        14,
        28,
      );

      doc.autoTable({
        head: [['Hour', 'Entered', 'Left', 'Still inside']],
        body: hourly.map((row) => [formatHour(row.hour), row.entered, row.exited, row.stillIn]),
        startY: 33,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });

      if (onSiteNow.length > 0) {
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text('On site now (no exit recorded)', 14, finalY);
        doc.autoTable({
          head: [['Plate', 'Driver', 'Make', 'Colour', 'Unit', 'Entered', 'On site for']],
          body: onSiteNow.map((vehicle) => [
            vehicle.license_plate || '-',
            vehicle.driver_name || '-',
            vehicle.vehicle_make || '-',
            vehicle.vehicle_color || '-',
            vehicle.visiting_unit || '-',
            new Date(vehicle.entered_at).toLocaleString(),
            formatStay(Date.now() - new Date(vehicle.entered_at).getTime()),
          ]),
          startY: finalY + 5,
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [239, 68, 68], textColor: 255 },
        });
      }

      await exportPdfDocument(doc, buildDatedReportFileName('VehicleReport'), {
        preferShare: true,
        shareTitle: `Vehicle Report — ${siteName}`,
        shareText: `NightGuard vehicle report, ${periodLabel}.`,
      });
    } catch (err) {
      setError(err.message || 'Failed to share the PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={reportPageStyle}>
      <ReportHeader
        title="Vehicle Report"
        purpose="Vehicles logged at the gate, and which of them are still on site. Works with no signal — offline it shows the copy saved on this device."
      >
        <ShareButton onClick={handleSharePDF} disabled={vehicles.length === 0} busy={exporting} />
      </ReportHeader>

      <DataFreshness
        online={!servedFromCache}
        generatedAt={loadedAt}
        note={servedFromCache
          ? `Last synced ${getLastSyncAt() ? new Date(getLastSyncAt()).toLocaleString() : 'never'}`
          : null}
      />

      <DateRangeFilter from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />

      {error && <div style={{ color: REPORT_COLORS.warning, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: REPORT_COLORS.textMuted }}>Loading vehicles…</div>
      ) : (
        <>
          <KpiRow>
            <StatTile label="Entered" value={inPeriod.length} hint={periodLabel} />
            <StatTile label="Left" value={exitedInPeriod} hint="Exit recorded in this period" />
            <StatTile
              label="On site now"
              value={onSiteNow.length}
              tone={onSiteNow.length ? 'warning' : 'good'}
              hint="Live count — not affected by the date filter"
            />
            <StatTile label="Average stay" value={formatStay(averageStayMs)} hint="Vehicles that entered and left in this period" />
          </KpiRow>

          {pendingSync > 0 && (
            <div style={{ marginBottom: 14 }}>
              <StatusPill tone="info">
                {`${pendingSync} record${pendingSync === 1 ? '' : 's'} on this device not uploaded yet — included below`}
              </StatusPill>
            </div>
          )}

          <Panel
            title="Busiest hours"
            subtitle="Vehicles entering per hour, newest first. Bar length is the number of entries."
          >
            <BarList
              rows={hourly.slice(0, 24).map((row) => ({
                key: row.hour,
                label: formatHour(row.hour),
                value: row.entered,
              }))}
              emptyText={vehicles.length ? 'No vehicles entered in the selected period' : 'No vehicles logged yet'}
            />
          </Panel>

          <Panel
            title={`On site now (${onSiteNow.length})`}
            subtitle="No exit has been recorded for these. Oldest first — anything near the top of this list is worth a check."
            right={onSiteNow.length
              ? <StatusPill tone="warning">Needs an exit</StatusPill>
              : <StatusPill tone="good">Gate is clear</StatusPill>}
          >
            {onSiteNow.length === 0 ? (
              <div style={{ color: REPORT_COLORS.textMuted, fontSize: 13 }}>
                Every vehicle logged has been signed out.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {onSiteNow.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    style={{
                      background: REPORT_COLORS.surfaceRaised,
                      border: `1px solid ${REPORT_COLORS.borderStrong}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ color: REPORT_COLORS.textPrimary, fontWeight: 700, fontSize: 14 }}>
                        {vehicle.license_plate || vehicle.driver_name || 'Unrecorded plate'}
                      </span>
                      <span style={{ color: REPORT_COLORS.warning, fontSize: 12, fontWeight: 600 }}>
                        {formatStay(asOf - new Date(vehicle.entered_at).getTime())} on site
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: REPORT_COLORS.textMuted }}>
                      <span>Driver: {vehicle.driver_name || '—'}</span>
                      {(vehicle.vehicle_make || vehicle.vehicle_color) && (
                        <span>{[vehicle.vehicle_make, vehicle.vehicle_color].filter(Boolean).join(' · ')}</span>
                      )}
                      <span>Unit: {vehicle.visiting_unit || '—'}</span>
                      <span>In: {new Date(vehicle.entered_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {vehicles.length === 0 && (
            <EmptyState
              title="No vehicles logged yet"
              detail={servedFromCache
                ? 'Nothing is saved on this device for this site. Reconnect and the report will fill in on its own.'
                : 'Vehicles appear here as soon as one is logged at the gate.'}
            />
          )}
        </>
      )}
    </div>
  );
}
