import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  BarList,
  DataFreshness,
  DateRangeFilter,
  EmptyState,
  KpiRow,
  Meter,
  Panel,
  ReportHeader,
  ShareButton,
  StatTile,
  StatusPill,
} from '../components/ReportKit';
import { REPORT_COLORS, reportPageStyle } from '../lib/reportTheme';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { getShiftReport } from '../services/api';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { logApiError, logApiAttempt, logApiSuccess } from '../lib/apiErrorLogger';
import {
  buildDailyCoverage,
  buildShiftReport,
  formatDuration,
  formatHours,
  rollUpByGuard,
  summariseShiftRows,
} from '../lib/shiftAnalytics';

// ============================================================================
//  Shift Summary — the CLIENT REPORT.
//
//  Its job: "what did we deliver at this site over this period?" It answers with
//  cover provided, patrols walked, checkpoint coverage, incidents, and gate traffic,
//  then breaks the same numbers down per guard. It used to group completed shifts by
//  name and add up `duration_hours` — a column nothing has ever written — so every
//  guard showed "0h 0m" and the page told a stakeholder nothing at all.
//
//  Everything here is derived from the same rows the Completed Shifts log lists, so
//  the two pages can never disagree.
// ============================================================================

// No setState in here on purpose — see the effect below.
async function fetchSummarySafely() {
  try {
    logApiAttempt('ShiftSummaryReport', 'GET', '/shifts/report');
    const payload = await getShiftReport();
    logApiSuccess('ShiftSummaryReport', 'GET', '/shifts/report', payload?.shifts?.length || 0);
    return { payload, error: '' };
  } catch (err) {
    const details = logApiError(navigator.onLine, err, 'ShiftSummaryReport');
    return { payload: null, error: `Could not load the summary: ${details.errorMsg}` };
  }
}

export default function ShiftSummaryReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  // Clients ask about a period, not about all history — default to the last 30 days
  // so the page opens on the question that actually gets asked.
  const [dateFrom, setDateFrom] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    return start.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    let active = true;

    const run = async () => {
      const result = await fetchSummarySafely();
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

  const checkpointsConfigured = data?.checkpointsConfigured || 0;

  const rows = useMemo(() => {
    if (!data) return [];
    return buildShiftReport(data).rows.filter((row) => {
      const fromMatch = dateFrom ? row.startTime >= new Date(dateFrom).getTime() : true;
      const toMatch = dateTo ? row.startTime <= new Date(`${dateTo}T23:59:59`).getTime() : true;
      return fromMatch && toMatch;
    });
  }, [data, dateFrom, dateTo]);

  const totals = useMemo(() => summariseShiftRows(rows, checkpointsConfigured), [rows, checkpointsConfigured]);
  const guards = useMemo(() => rollUpByGuard(rows), [rows]);
  const days = useMemo(() => buildDailyCoverage(rows), [rows]);

  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || 'start'} to ${dateTo || 'today'}`
    : 'All time';
  const daysWithoutCover = days.filter((day) => day.shifts === 0).length;

  const handleSharePDF = async () => {
    setExporting(true);
    setError('');
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getSiteDisplayName();

    doc.setFontSize(15);
    doc.text(`Security Cover Report — ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Period: ${periodLabel}   |   Prepared: ${new Date().toLocaleString()}`, 14, 22);

    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text('Cover delivered', 14, 32);
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text([
      `Shifts worked: ${totals.shifts}   ·   Hours on site: ${formatHours(totals.totalMs)}   ·   Average shift: ${formatDuration(totals.averageMs)}`,
      `Patrols: ${totals.patrolsCompleted} completed of ${totals.patrols} started   ·   Checkpoint coverage: ${totals.coveragePercent === null ? 'not measurable (no patrol points configured)' : `${totals.coveragePercent}%`}`,
      `Incidents reported: ${totals.incidents}   ·   Vehicles logged: ${totals.vehicles}   ·   Visitors logged: ${totals.pedestrians}   ·   OB entries: ${totals.obEntries}`,
      `Days in period with no shift recorded: ${daysWithoutCover}`,
      totals.flaggedShifts
        ? `Note: ${totals.flaggedShifts} shift(s) were never signed off on the device and are excluded from the hours above.`
        : 'All shifts in this period were signed off on the device.',
    ], 14, 38);

    doc.autoTable({
      head: [['Guard', 'Shifts', 'Hours', 'Sundays', 'Nights', 'Patrols done', 'Points hit', 'Incidents', 'Vehicles', 'Visitors']],
      body: guards.map((guard) => [
        guard.guardName,
        guard.shifts,
        formatHours(guard.totalMs),
        guard.sundayShifts,
        guard.nightShifts,
        `${guard.patrolsCompleted}/${guard.patrols}`,
        guard.pointsVisited,
        guard.incidents,
        guard.vehicles,
        guard.pedestrians,
      ]),
      startY: 68,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    try {
      await exportPdfDocument(doc, buildDatedReportFileName('SecurityCoverReport'), {
        preferShare: true,
        shareTitle: `Security Cover Report — ${siteName}`,
        shareText: `NightGuard cover report for ${siteName} (${periodLabel}).`,
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
        title="Shift Summary"
        purpose="The report you send the client: cover delivered at this site over a period, and how it breaks down per guard. Share it straight to WhatsApp, email or Drive. For the shift-by-shift log, open Completed Shifts."
      >
        <ShareButton onClick={handleSharePDF} disabled={rows.length === 0} busy={exporting}>
          Share client PDF
        </ShareButton>
      </ReportHeader>

      <DataFreshness
        online={data?.online ?? navigator.onLine}
        generatedAt={data?.generatedAt}
        note={data && !data.online ? 'Reconnect before sending this to a client' : null}
      />

      <DateRangeFilter from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />

      {error && <div style={{ color: REPORT_COLORS.critical, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: REPORT_COLORS.textMuted }}>Loading summary…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No shifts in this period"
          detail="Widen the date range, or check that guards are signing off at the end of a shift — a shift only lands here once it has been ended on the device."
        />
      ) : (
        <>
          <KpiRow>
            <StatTile label="Hours on site" value={formatHours(totals.totalMs)} hint={`Across ${totals.countedShifts} signed-off shifts`} />
            <StatTile label="Shifts worked" value={totals.shifts} hint={periodLabel} />
            <StatTile label="Average shift" value={formatDuration(totals.averageMs)} hint="Signed-off shifts only" />
            <StatTile
              label="Incidents"
              value={totals.incidents}
              tone={totals.incidents ? 'warning' : 'good'}
              hint={totals.incidents ? 'Reported by guards on duty' : 'None reported this period'}
            />
          </KpiRow>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Meter
              percent={totals.coveragePercent}
              label="Checkpoint coverage"
              caption={checkpointsConfigured
                ? `${totals.pointsVisited} checkpoint visits against ${checkpointsConfigured} points × ${totals.patrols} patrols.`
                : 'No patrol points are configured for this site, so coverage cannot be measured. Add them under Config → Guard Patrol.'}
            />
            <Meter
              percent={totals.patrols ? Math.round((totals.patrolsCompleted / totals.patrols) * 100) : null}
              label="Patrols completed"
              caption={totals.patrols
                ? `${totals.patrolsCompleted} of ${totals.patrols} started patrols were finished.`
                : 'No patrols were started in this period.'}
            />
          </div>

          {/* Gaps are the thing a stakeholder actually wants to spot, and an average
              hides them by design. One bar per day, days with no cover included. */}
          <Panel
            title="Cover by day"
            subtitle={daysWithoutCover
              ? `${daysWithoutCover} day${daysWithoutCover === 1 ? '' : 's'} in this period had no shift recorded at all.`
              : 'Every day in this period had at least one shift recorded.'}
            right={daysWithoutCover ? <StatusPill tone="warning">{`${daysWithoutCover} day gap`}</StatusPill> : <StatusPill tone="good">No gaps</StatusPill>}
          >
            <BarList
              rows={days.map((day) => ({
                key: day.date.toISOString(),
                label: day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
                value: Number((day.ms / 3600000).toFixed(1)),
                color: day.shifts === 0 ? REPORT_COLORS.critical : REPORT_COLORS.rampFill,
              }))}
              formatValue={(value) => (value ? `${value}h` : '0')}
              emptyText="No days to show"
            />
          </Panel>

          <Panel
            title="Per guard"
            subtitle="Same shifts, grouped by who worked them. Hours exclude shifts that were never signed off."
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${REPORT_COLORS.borderStrong}` }}>
                    {['Guard', 'Shifts', 'Hours', 'Sun', 'Night', 'Patrols', 'Points', 'Incidents'].map((heading, index) => (
                      <th
                        key={heading}
                        style={{
                          padding: '9px 8px',
                          textAlign: index === 0 ? 'left' : 'right',
                          color: REPORT_COLORS.textMuted,
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guards.map((guard) => (
                    <tr key={guard.guardName} style={{ borderBottom: '1px solid #161616' }}>
                      <td style={{ padding: '9px 8px', fontWeight: 600, color: REPORT_COLORS.textPrimary }}>
                        {guard.guardName}
                        {guard.flaggedShifts > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <StatusPill tone="warning">{`${guard.flaggedShifts} not signed off`}</StatusPill>
                          </div>
                        )}
                      </td>
                      <Cell>{guard.shifts}</Cell>
                      <Cell>{formatHours(guard.totalMs)}</Cell>
                      <Cell>{guard.sundayShifts}</Cell>
                      <Cell>{guard.nightShifts}</Cell>
                      <Cell>{`${guard.patrolsCompleted}/${guard.patrols}`}</Cell>
                      <Cell>{guard.pointsVisited}</Cell>
                      <Cell tone={guard.incidents ? REPORT_COLORS.warning : undefined}>{guard.incidents}</Cell>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {guards.length === 1 && guards[0].guardName === 'General Guard' && (
              // Not a bug and no code fixes it — see CLAUDE.md. Say it here rather than
              // letting a client wonder why one name covers every shift.
              <p style={{ margin: '12px 0 0', color: REPORT_COLORS.textMuted, fontSize: 12, lineHeight: 1.5 }}>
                Every shift is attributed to the built-in General Guard because no named guards have been
                created for this site yet. Add them in the admin panel and future shifts will carry real names.
              </p>
            )}
          </Panel>

          <Panel
            title="Gate activity"
            subtitle="Traffic handled by guards on duty during these shifts."
          >
            <BarList
              rows={[
                { key: 'vehicles', label: 'Vehicles', value: totals.vehicles },
                { key: 'visitors', label: 'Visitors', value: totals.pedestrians },
                { key: 'ob', label: 'OB entries', value: totals.obEntries },
                { key: 'incidents', label: 'Incidents', value: totals.incidents, color: REPORT_COLORS.series2 },
              ]}
              emptyText="Nothing logged at the gate in this period"
            />
          </Panel>
        </>
      )}
    </div>
  );
}

function Cell({ children, tone }) {
  return (
    <td style={{
      padding: '9px 8px',
      textAlign: 'right',
      color: tone || REPORT_COLORS.textSecondary,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </td>
  );
}
