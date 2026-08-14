import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  DataFreshness,
  DateRangeFilter,
  EmptyState,
  KpiRow,
  ReportHeader,
  ShareButton,
  StatTile,
  StatusPill,
} from '../components/ReportKit';
import { REPORT_COLORS, reportPageStyle, textControlStyle } from '../lib/reportTheme';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { getShiftReport } from '../services/api';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { logApiError, logApiAttempt, logApiSuccess } from '../lib/apiErrorLogger';
import {
  buildShiftReport,
  formatDateTime,
  formatDuration,
  formatHours,
  summariseShiftRows,
} from '../lib/shiftAnalytics';

// ============================================================================
//  Completed Shifts — the shift-by-shift EVIDENCE LOG.
//
//  Its job: "show me every shift worked, when it started and ended, and what was
//  done during it." One row per shift, nothing aggregated. The client-facing
//  roll-up (totals, per-guard, coverage over the period) is Shift Summary — these
//  two are not two views of the same table, they answer different questions, and
//  each one now says so at the top.
// ============================================================================

const END_STATUS_TONE = {
  ended: 'good',
  auto_closed: 'warning',
  over_length: 'warning',
  open: 'critical',
};

// Fetching is kept free of setState so the effect below can do all of its state
// writing after an await — no synchronous cascade on mount, and nothing written
// into an unmounted screen.
async function fetchShiftReportSafely() {
  try {
    logApiAttempt('CompletedShiftsReport', 'GET', '/shifts/report');
    const payload = await getShiftReport();
    logApiSuccess('CompletedShiftsReport', 'GET', '/shifts/report', payload?.shifts?.length || 0);
    return { payload, error: '' };
  } catch (err) {
    const details = logApiError(navigator.onLine, err, 'CompletedShiftsReport');
    return { payload: null, error: `Could not load shifts: ${details.errorMsg}` };
  }
}

export default function CompletedShiftsReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterName, setFilterName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async () => {
      const result = await fetchShiftReportSafely();
      // Every setState here happens after an await, and only while still mounted:
      // a screen the guard navigated away from must not write into a dead tree.
      if (!active) return;
      setData(result.payload);
      setError(result.error);
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

  const allRows = useMemo(() => (
    data ? buildShiftReport(data).rows : []
  ), [data]);

  const rows = useMemo(() => allRows.filter((row) => {
    const nameMatch = row.guardName.toLowerCase().includes(filterName.trim().toLowerCase());
    const fromMatch = dateFrom ? row.startTime >= new Date(dateFrom).getTime() : true;
    const toMatch = dateTo ? row.startTime <= new Date(`${dateTo}T23:59:59`).getTime() : true;
    const flagMatch = showFlaggedOnly ? !row.endStatus.counts : true;
    return nameMatch && fromMatch && toMatch && flagMatch;
  }), [allRows, filterName, dateFrom, dateTo, showFlaggedOnly]);

  const totals = useMemo(
    () => summariseShiftRows(rows, data?.checkpointsConfigured || 0),
    [rows, data?.checkpointsConfigured],
  );

  const handleSharePDF = async () => {
    setExporting(true);
    setError('');

    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getSiteDisplayName();
    doc.setFontSize(14);
    doc.text(`Completed Shifts — ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    const period = dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : 'All time';
    doc.text(`Period: ${period}   |   Exported: ${new Date().toLocaleString()}`, 14, 22);
    doc.text(
      `${totals.shifts} shifts · ${formatHours(totals.totalMs)} on site · ${totals.patrols} patrols · ${totals.incidents} incidents`
      + (totals.flaggedShifts ? `   |   ${totals.flaggedShifts} shift(s) excluded from hours (never signed off)` : ''),
      14,
      28,
    );

    doc.autoTable({
      head: [['Guard', 'Shift', 'Start', 'End', 'Worked', 'How it ended', 'Patrols', 'Points', 'Incidents', 'Vehicles', 'Visitors']],
      body: rows.map((row) => [
        row.guardName,
        row.shiftName + (row.isSunday ? ' (Sun)' : ''),
        formatDateTime(row.startedAt),
        formatDateTime(row.endedAt),
        row.endStatus.counts ? formatDuration(row.durationMs) : '—',
        row.endStatus.label,
        `${row.patrolsCompleted}/${row.patrols}`,
        row.pointsVisited,
        row.incidents,
        row.vehicles,
        row.pedestrians,
      ]),
      startY: 33,
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    try {
      await exportPdfDocument(doc, buildDatedReportFileName('CompletedShifts'), {
        preferShare: true,
        shareTitle: `Completed Shifts — ${siteName}`,
        shareText: `NightGuard completed shifts, ${period}.`,
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
        title="Completed Shifts"
        purpose="Every shift worked at this site, one row each, with what was recorded during it. Use Shift Summary for the client-facing totals."
      >
        <ShareButton onClick={handleSharePDF} disabled={rows.length === 0} busy={exporting} />
      </ReportHeader>

      <DataFreshness
        online={data?.online ?? navigator.onLine}
        generatedAt={data?.generatedAt}
        note={data && !data.online ? 'Reconnect to pull anything recorded on other devices' : null}
      />

      <DateRangeFilter
        from={dateFrom}
        to={dateTo}
        onFrom={setDateFrom}
        onTo={setDateTo}
        extra={(
          <input
            type="text"
            placeholder="Guard name…"
            value={filterName}
            onChange={(event) => setFilterName(event.target.value)}
            style={{ ...textControlStyle, flex: '1 1 130px' }}
          />
        )}
      />

      {error && (
        <div style={{ color: REPORT_COLORS.critical, marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {!loading && (
        <>
          <KpiRow>
            <StatTile
              label="Shifts"
              value={totals.shifts}
              hint={dateFrom || dateTo ? 'In the selected period' : 'All recorded shifts'}
            />
            <StatTile
              label="Hours on site"
              value={formatHours(totals.totalMs)}
              hint={`From ${totals.countedShifts} properly signed-off shift${totals.countedShifts === 1 ? '' : 's'}`}
            />
            <StatTile
              label="Average shift"
              value={formatDuration(totals.averageMs)}
              hint="Signed-off shifts only"
            />
            <StatTile
              label="Needs attention"
              value={totals.flaggedShifts}
              tone={totals.flaggedShifts ? 'warning' : 'good'}
              hint={totals.flaggedShifts
                ? 'Never signed off — excluded from hours'
                : 'Every shift was signed off on the device'}
            />
          </KpiRow>

          {/* Activity is what makes a shift list mean something to a client: hours
              alone say a phone was switched on, not that the site was walked. */}
          <KpiRow min={120}>
            <StatTile label="Patrols" value={`${totals.patrolsCompleted}/${totals.patrols}`} hint="Completed / started" />
            <StatTile label="Checkpoints hit" value={totals.pointsVisited} hint={`Site has ${data?.checkpointsConfigured || 0} points set up`} />
            <StatTile label="Incidents" value={totals.incidents} tone={totals.incidents ? 'warning' : undefined} hint="Reported during these shifts" />
            <StatTile label="Vehicles" value={totals.vehicles} hint="Logged at the gate" />
            <StatTile label="Visitors" value={totals.pedestrians} hint="Pedestrians logged" />
            <StatTile label="OB entries" value={totals.obEntries} hint="Occurrence book" />
          </KpiRow>

          {totals.flaggedShifts > 0 && (
            <button
              type="button"
              onClick={() => setShowFlaggedOnly((value) => !value)}
              style={{
                ...textControlStyle,
                cursor: 'pointer',
                marginBottom: 14,
                color: showFlaggedOnly ? '#fcd34d' : REPORT_COLORS.textSecondary,
                borderColor: showFlaggedOnly ? '#854d0e' : REPORT_COLORS.borderStrong,
              }}
            >
              {showFlaggedOnly
                ? 'Showing shifts that need attention — show all'
                : `Show only the ${totals.flaggedShifts} shift${totals.flaggedShifts === 1 ? '' : 's'} that need attention`}
            </button>
          )}
        </>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: REPORT_COLORS.textMuted }}>Loading shifts…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={allRows.length ? 'No shifts match these filters' : 'No completed shifts yet'}
          detail={allRows.length
            ? 'Widen the date range or clear the guard name filter.'
            : 'A shift appears here once a guard signs off on the device. Shifts still running are not shown.'}
        />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <ShiftCard key={row.id} row={row} checkpointsConfigured={data?.checkpointsConfigured || 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftCard({ row, checkpointsConfigured }) {
  const tone = END_STATUS_TONE[row.endStatus.key] || 'neutral';

  return (
    <article style={{
      background: REPORT_COLORS.surface,
      border: `1px solid ${row.endStatus.counts ? REPORT_COLORS.border : '#4a3308'}`,
      borderRadius: 12,
      padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ color: REPORT_COLORS.textPrimary, fontWeight: 700, fontSize: 15 }}>{row.guardName}</div>
          <div style={{ color: REPORT_COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
            {row.shiftName}
            {row.isSunday && ' · Sunday'}
            {row.isNightShift && ' · Night'}
            {row.crossesMidnight && ' · Overnight'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: row.endStatus.counts ? REPORT_COLORS.good : REPORT_COLORS.warning, fontWeight: 700, fontSize: 16 }}>
            {formatDuration(row.durationMs)}
          </div>
          <div style={{ marginTop: 4 }}>
            <StatusPill tone={tone} title={row.endStatus.detail}>{row.endStatus.label}</StatusPill>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        <Fact label="Start" value={formatDateTime(row.startedAt)} />
        <Fact label="End" value={formatDateTime(row.endedAt)} />
      </div>

      {!row.endStatus.counts && (
        <div style={{ color: '#fcd34d', fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>
          {row.endStatus.detail}. These hours are shown but not added to the site total.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="Patrols" value={`${row.patrolsCompleted}/${row.patrols}`} />
        <Chip
          label="Points"
          value={checkpointsConfigured ? `${row.pointsVisited}/${checkpointsConfigured}` : String(row.pointsVisited)}
        />
        {row.incidents > 0 && <Chip label="Incidents" value={row.incidents} tone="warning" />}
        {row.vehicles > 0 && <Chip label="Vehicles" value={row.vehicles} />}
        {row.pedestrians > 0 && <Chip label="Visitors" value={row.pedestrians} />}
        {row.obEntries > 0 && <Chip label="OB" value={row.obEntries} />}
      </div>
    </article>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <div style={{ color: REPORT_COLORS.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ color: REPORT_COLORS.textSecondary, fontSize: 13, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Chip({ label, value, tone }) {
  const color = tone === 'warning' ? '#fcd34d' : REPORT_COLORS.textSecondary;
  return (
    <span style={{
      background: REPORT_COLORS.surfaceRaised,
      border: `1px solid ${REPORT_COLORS.borderStrong}`,
      borderRadius: 8,
      padding: '5px 9px',
      fontSize: 12,
      color: REPORT_COLORS.textMuted,
    }}>
      {label} <strong style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </span>
  );
}
