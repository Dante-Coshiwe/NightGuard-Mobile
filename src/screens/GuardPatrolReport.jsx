import React, { useCallback, useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getCachedPatrols, getNfcScans, getPatrolConfig } from '../lib/deviceStore';
import CheckpointMap from '../components/CheckpointMap';
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
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { buildDatedReportFileName, exportPdfDocument, getSiteDisplayName } from '../lib/reportUtils';
import { logApiError, logApiAttempt, logOfflineUsage } from '../lib/apiErrorLogger';

// ============================================================================
//  Guard Patrol Dashboard.
//
//  What was wrong with the numbers here, and what replaced them:
//
//  * "Scanned checkpoints 100%" and "Missed checkpoints 0%" on every device, always.
//    Both were computed over the SCAN list — and a scan row exists precisely because
//    somebody scanned, so `scanned` was the whole list and `missed` was `length -
//    length`. The denominator has to be the points the site actually configured, and
//    the numerator the distinct ones reached. That is what "Checkpoint coverage" is now.
//
//  * Four donuts carrying two facts. "Acknowledged" and "Missing" are complements —
//    the second chart is 100 minus the first and adds nothing — and the same for the
//    checkpoint pair. Two meters now carry both, and the space went to the thing that
//    was missing: WHICH points were missed.
//
//  * The guard table counted each guard twice. Patrols were keyed on `guard_id` and
//    scans on `scanned_by`, two different id spaces, so one person became two rows —
//    one with patrols and no scans, one with scans and no patrols. Keyed on name now.
//
//  * The admin "My patrols / All guards" selector did nothing: loadData ignored it
//    and `/patrols/summary` is site-wide either way. Removed rather than left as a
//    control that changes nothing.
// ============================================================================

// A scan names its checkpoint by id when the point came from the server and by name
// when it came from the local patrol config (`cp-1`, `cp-2`…). Match on either.
function checkpointKeys(point, index) {
  return {
    id: String(point.id ?? `idx-${index}`),
    name: String(point.name || point.checkpoint_name || '').trim().toLowerCase(),
  };
}

function scanMatchesPoint(scan, keys) {
  if (scan.checkpoint_id && String(scan.checkpoint_id) === keys.id) return true;
  const scanName = String(scan.checkpoint_name || scan.point_name || '').trim().toLowerCase();
  return Boolean(keys.name) && scanName === keys.name;
}

// No setState in here on purpose — see the effect below.
async function fetchPatrolDataSafely() {
  const loadedAt = new Date().toISOString();
  let usedCache = false;

  logApiAttempt('GuardPatrolReport', 'GET', '/patrols/summary');
  logApiAttempt('GuardPatrolReport', 'GET', '/nfc/scans');

  const [summary, scanRows] = await Promise.all([
    api.get('/patrols/summary').then((res) => res.data).catch((err) => {
      logApiError(navigator.onLine, err, 'GuardPatrolReport-summary');
      usedCache = true;
      return getCachedPatrols();
    }),
    api.get('/nfc/scans').then((res) => res.data).catch((err) => {
      logApiError(navigator.onLine, err, 'GuardPatrolReport-scans');
      usedCache = true;
      return getNfcScans();
    }),
  ]);

  if (usedCache) logOfflineUsage('GuardPatrolReport', 'device cache');

  return {
    patrols: Array.isArray(summary) ? summary : [],
    scans: Array.isArray(scanRows) ? scanRows : [],
    fromCache: usedCache || !navigator.onLine,
    // Falling back offline is normal and gets no error text; falling back while
    // online means something is actually wrong and is worth saying out loud.
    error: usedCache && navigator.onLine
      ? 'Could not reach the server — showing patrol data saved on this device.'
      : '',
    loadedAt,
  };
}

export default function GuardPatrolDashboard() {
  const { user } = useAuth();
  const [patrols, setPatrols] = useState([]);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [servedFromCache, setServedFromCache] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  // One effect, one load. There used to be two — one keyed on the (unused) view mode
  // and one on mount — so every visit ran the whole fetch twice.
  useEffect(() => {
    let active = true;

    const run = async () => {
      const result = await fetchPatrolDataSafely();
      if (!active) return;
      setPatrols(result.patrols);
      setScans(result.scans);
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

  const patrolConfig = useMemo(() => getPatrolConfig(), []);
  const configuredPoints = useMemo(() => (
    (patrolConfig.checkpoints || []).filter((point) => String(point?.name || '').trim())
  ), [patrolConfig]);

  const withinPeriod = useCallback((value) => {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time) || !time) return false;
    if (dateFrom && time < new Date(dateFrom).getTime()) return false;
    if (dateTo && time > new Date(`${dateTo}T23:59:59`).getTime()) return false;
    return true;
  }, [dateFrom, dateTo]);

  const filteredPatrols = useMemo(
    () => patrols.filter((patrol) => withinPeriod(patrol.actual_start || patrol.created_at)),
    [patrols, withinPeriod],
  );
  const filteredScans = useMemo(
    () => scans
      .filter((scan) => withinPeriod(scan.scanned_at || scan.created_at))
      .sort((a, b) => new Date(b.scanned_at || b.created_at || 0) - new Date(a.scanned_at || a.created_at || 0)),
    [scans, withinPeriod],
  );

  // Per configured point: how many times it was reached in the period. A point with
  // zero visits is the finding — it is the one thing this page exists to surface.
  const pointStats = useMemo(() => configuredPoints.map((point, index) => {
    const keys = checkpointKeys(point, index);
    const hits = filteredScans.filter((scan) => scanMatchesPoint(scan, keys));
    const lastHit = hits[0]?.scanned_at || hits[0]?.created_at || null;
    return {
      id: keys.id,
      name: point.name || point.checkpoint_name || `Point ${index + 1}`,
      zone: point.zone || '',
      visits: hits.length,
      lastHit,
    };
  }).sort((a, b) => a.visits - b.visits), [configuredPoints, filteredScans]);

  const pointsReached = pointStats.filter((point) => point.visits > 0);
  const pointsMissed = pointStats.filter((point) => point.visits === 0);
  const coveragePercent = configuredPoints.length
    ? Math.round((pointsReached.length / configuredPoints.length) * 100)
    : null;

  const patrolsCompleted = filteredPatrols.filter(
    (patrol) => patrol.status === 'completed' || patrol.acknowledged,
  ).length;
  const completionPercent = filteredPatrols.length
    ? Math.round((patrolsCompleted / filteredPatrols.length) * 100)
    : null;

  // Adherence needs a real denominator: the site's schedule × days covered. Without
  // a schedule there is nothing to be adherent to, so it says so rather than inventing one.
  const scheduleAdherence = useMemo(() => {
    const perDay = (patrolConfig.patrolTimes || []).length;
    if (!perDay || !filteredPatrols.length) return null;
    const stamps = filteredPatrols.map((patrol) => new Date(patrol.actual_start || patrol.created_at).getTime());
    const spanDays = Math.max(1, Math.ceil((Math.max(...stamps) - Math.min(...stamps)) / 86400000) || 1);
    const expected = perDay * spanDays;
    return {
      expected,
      perDay,
      spanDays,
      percent: Math.min(100, Math.round((filteredPatrols.length / expected) * 100)),
    };
  }, [patrolConfig.patrolTimes, filteredPatrols]);

  // One row per guard, keyed on the NAME so patrols and scans land on the same person.
  const guardStats = useMemo(() => {
    const stats = new Map();
    const ensure = (name) => {
      const key = name || 'Unassigned guard';
      if (!stats.has(key)) {
        stats.set(key, { guardName: key, patrols: 0, completed: 0, scans: 0, points: new Set() });
      }
      return stats.get(key);
    };

    filteredPatrols.forEach((patrol) => {
      const entry = ensure(patrol.guard_name || patrol.profiles?.full_name);
      entry.patrols += 1;
      if (patrol.status === 'completed' || patrol.acknowledged) entry.completed += 1;
    });

    filteredScans.forEach((scan) => {
      const entry = ensure(scan.guard_name || scan.profiles?.full_name);
      entry.scans += 1;
      const label = String(scan.checkpoint_name || scan.point_name || scan.checkpoint_id || '').trim().toLowerCase();
      if (label) entry.points.add(label);
    });

    return [...stats.values()]
      .map((entry) => ({ ...entry, distinctPoints: entry.points.size }))
      .sort((a, b) => (b.patrols + b.scans) - (a.patrols + a.scans));
  }, [filteredPatrols, filteredScans]);

  const queuedScans = filteredScans.filter((scan) => scan.offline || scan._offline).length;
  const nfcScanCount = filteredScans.filter((scan) => scan.method !== 'gps').length;
  const latestScan = filteredScans[0] || null;
  const periodLabel = dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : 'All time';
  const reachedIds = useMemo(() => pointsReached.map((point) => point.id), [pointsReached]);

  const handleSharePDF = async () => {
    setExporting(true);
    setError('');
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getSiteDisplayName();

    doc.setFontSize(15);
    doc.text(`Guard Patrol Report — ${siteName}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Period: ${periodLabel}   |   Exported: ${new Date().toLocaleString()}   |   By: ${user?.name || user?.username || 'Unknown'}`, 14, 22);
    doc.text([
      `Checkpoint coverage: ${coveragePercent === null ? 'no points configured' : `${coveragePercent}% (${pointsReached.length} of ${configuredPoints.length} points reached)`}`,
      `Patrols: ${patrolsCompleted} completed of ${filteredPatrols.length} started   ·   Check-ins recorded: ${filteredScans.length}`,
      pointsMissed.length
        ? `Points never reached in this period: ${pointsMissed.map((point) => point.name).join(', ')}`
        : 'Every configured checkpoint was reached at least once.',
    ], 14, 28);

    doc.autoTable({
      head: [['Checkpoint', 'Zone', 'Visits', 'Last reached']],
      body: pointStats.map((point) => [
        point.name,
        point.zone || '-',
        point.visits,
        point.lastHit ? new Date(point.lastHit).toLocaleString() : 'Never in this period',
      ]),
      startY: 46,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    if (guardStats.length > 0) {
      doc.autoTable({
        head: [['Guard', 'Patrols started', 'Patrols completed', 'Check-ins', 'Distinct points']],
        body: guardStats.map((guard) => [
          guard.guardName, guard.patrols, guard.completed, guard.scans, guard.distinctPoints,
        ]),
        startY: doc.lastAutoTable.finalY + 10,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
    }

    if (filteredScans.length > 0) {
      doc.addPage();
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('Check-in log', 14, 18);
      doc.autoTable({
        head: [['Date/Time', 'Checkpoint', 'Method', 'Guard', 'Position']],
        body: filteredScans.slice(0, 400).map((scan) => [
          new Date(scan.scanned_at || scan.created_at).toLocaleString(),
          scan.checkpoint_name || scan.point_name || '-',
          scan.method === 'gps' ? 'GPS' : 'NFC',
          scan.guard_name || '-',
          Number.isFinite(Number(scan.latitude))
            ? `${Number(scan.latitude).toFixed(4)}, ${Number(scan.longitude).toFixed(4)}`
            : '-',
        ]),
        startY: 24,
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [25, 158, 112], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
    }

    try {
      await exportPdfDocument(doc, buildDatedReportFileName('GuardPatrolReport'), {
        preferShare: true,
        shareTitle: `Guard Patrol Report — ${siteName}`,
        shareText: `NightGuard patrol report, ${periodLabel}.`,
      });
    } catch (err) {
      setError(err.message || 'Failed to share the PDF');
    } finally {
      setExporting(false);
    }
  };

  const hasAnything = filteredPatrols.length > 0 || filteredScans.length > 0;

  return (
    <div style={reportPageStyle}>
      <ReportHeader
        title="Guard Patrol Dashboard"
        purpose="Which checkpoints were actually reached, how many patrols were walked, and what is still waiting to upload."
      >
        <ShareButton onClick={handleSharePDF} disabled={!hasAnything} busy={exporting} />
      </ReportHeader>

      <DataFreshness
        online={!servedFromCache}
        generatedAt={loadedAt}
        note={servedFromCache ? 'Reconnect to pull patrols walked on other devices' : null}
      />

      <DateRangeFilter from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />

      {error && <div style={{ color: REPORT_COLORS.warning, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 50, color: REPORT_COLORS.textMuted }}>Loading patrol data…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Meter
              percent={coveragePercent}
              label="Checkpoint coverage"
              caption={configuredPoints.length
                ? `${pointsReached.length} of ${configuredPoints.length} configured points were reached at least once in this period.`
                : 'No checkpoints are configured for this site. Add them under Config → Guard Patrol, or coverage cannot be measured.'}
            />
            <Meter
              percent={completionPercent}
              label="Patrols completed"
              caption={filteredPatrols.length
                ? `${patrolsCompleted} of ${filteredPatrols.length} started patrols were finished.`
                : 'No patrols were started in this period.'}
            />
          </div>

          <KpiRow min={140}>
            <StatTile label="Patrols walked" value={filteredPatrols.length} hint={periodLabel} />
            <StatTile label="Check-ins" value={filteredScans.length} hint={`${nfcScanCount} by NFC tag, ${filteredScans.length - nfcScanCount} by GPS`} />
            <StatTile
              label="Points never reached"
              value={pointsMissed.length}
              tone={pointsMissed.length ? 'warning' : 'good'}
              hint={pointsMissed.length ? 'Listed below with the rest' : 'Full route was covered'}
            />
            <StatTile
              label="Waiting to upload"
              value={queuedScans}
              tone={queuedScans ? 'info' : undefined}
              hint="Check-ins saved here, not yet on the server"
            />
            <StatTile
              label="Last check-in"
              value={latestScan ? new Date(latestScan.scanned_at || latestScan.created_at).toLocaleString() : 'None yet'}
              hint={latestScan?.checkpoint_name || 'No patrol activity in this period'}
            />
            <StatTile label="Guards active" value={guardStats.length} hint="With a patrol or a check-in in this period" />
          </KpiRow>

          {!hasAnything ? (
            <EmptyState
              title="No patrol activity in this period"
              detail="Widen the date range, or check that patrols are being started on the device. Check-ins only record while a patrol is running."
            />
          ) : (
            <>
              <Panel
                title="Checkpoints"
                subtitle="Every configured point and how often it was reached, fewest visits first — so the gaps sit at the top."
                right={pointsMissed.length
                  ? <StatusPill tone="warning">{`${pointsMissed.length} never reached`}</StatusPill>
                  : <StatusPill tone="good">All points reached</StatusPill>}
              >
                {configuredPoints.length === 0 ? (
                  <div style={{ color: REPORT_COLORS.textMuted, fontSize: 13, lineHeight: 1.5 }}>
                    No checkpoints are set up for this site yet, so there is nothing to measure coverage against.
                    Add them under Config → Guard Patrol.
                  </div>
                ) : (
                  <>
                    <BarList
                      rows={pointStats.map((point) => ({
                        key: point.id,
                        label: point.name,
                        value: point.visits,
                        color: point.visits === 0 ? REPORT_COLORS.critical : REPORT_COLORS.rampFill,
                      }))}
                      formatValue={(value) => (value === 0 ? '0' : value)}
                    />
                    {pointsMissed.length > 0 && (
                      <p style={{ margin: '12px 0 0', color: '#fca5a5', fontSize: 12, lineHeight: 1.5 }}>
                        Never reached in this period: {pointsMissed.map((point) => point.name).join(', ')}.
                      </p>
                    )}
                  </>
                )}
              </Panel>

              {scheduleAdherence && (
                <Panel
                  title="Against the schedule"
                  subtitle={`This site is set to ${scheduleAdherence.perDay} patrol${scheduleAdherence.perDay === 1 ? '' : 's'} a day. Over the ${scheduleAdherence.spanDays} day${scheduleAdherence.spanDays === 1 ? '' : 's'} covered here that is ${scheduleAdherence.expected} expected.`}
                  right={(
                    <StatusPill tone={scheduleAdherence.percent >= 80 ? 'good' : scheduleAdherence.percent >= 50 ? 'warning' : 'critical'}>
                      {`${scheduleAdherence.percent}% of schedule`}
                    </StatusPill>
                  )}
                >
                  <BarList
                    rows={[
                      { key: 'walked', label: 'Walked', value: filteredPatrols.length },
                      { key: 'expected', label: 'Expected', value: scheduleAdherence.expected, color: REPORT_COLORS.series2 },
                    ]}
                  />
                </Panel>
              )}

              <Panel title="Checkpoint layout" subtitle="Green points were reached in this period; blue dots are recorded check-in positions.">
                <CheckpointMap
                  checkpoints={configuredPoints}
                  scans={filteredScans}
                  reachedIds={reachedIds}
                  title="Site layout"
                />
              </Panel>

              {guardStats.length > 0 && (
                <Panel title="Per guard" subtitle="Patrols and check-ins grouped by who recorded them.">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${REPORT_COLORS.borderStrong}` }}>
                          {['Guard', 'Patrols', 'Completed', 'Check-ins', 'Points'].map((heading, index) => (
                            <th key={heading} style={{
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
                        {guardStats.map((guard) => (
                          <tr key={guard.guardName} style={{ borderBottom: '1px solid #161616' }}>
                            <td style={{ padding: '9px 8px', fontWeight: 600, color: REPORT_COLORS.textPrimary }}>{guard.guardName}</td>
                            <NumberCell>{guard.patrols}</NumberCell>
                            <NumberCell>{guard.completed}</NumberCell>
                            <NumberCell>{guard.scans}</NumberCell>
                            <NumberCell>{guard.distinctPoints}</NumberCell>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

              <Panel
                title={`Check-in log (${filteredScans.length})`}
                subtitle="Newest first. This is the raw evidence behind every number above."
              >
                {filteredScans.length === 0 ? (
                  <div style={{ color: REPORT_COLORS.textMuted, fontSize: 13 }}>No check-ins in this period.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                    {filteredScans.slice(0, 200).map((scan, index) => (
                      <div
                        key={scan.id || index}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 10,
                          flexWrap: 'wrap',
                          padding: '8px 10px',
                          background: REPORT_COLORS.surfaceRaised,
                          borderRadius: 8,
                          borderLeft: `3px solid ${scan.method === 'gps' ? REPORT_COLORS.series3 : REPORT_COLORS.series1}`,
                        }}
                      >
                        <span style={{ color: REPORT_COLORS.textPrimary, fontSize: 13, fontWeight: 600 }}>
                          {scan.checkpoint_name || scan.point_name || 'Checkpoint'}
                          <span style={{ color: REPORT_COLORS.textMuted, fontWeight: 400 }}>
                            {` · ${scan.method === 'gps' ? 'GPS' : 'NFC'}`}
                            {(scan.offline || scan._offline) && ' · not uploaded yet'}
                          </span>
                        </span>
                        <span style={{ color: REPORT_COLORS.textMuted, fontSize: 12 }}>
                          {new Date(scan.scanned_at || scan.created_at).toLocaleString()}
                          {scan.guard_name ? ` · ${scan.guard_name}` : ''}
                        </span>
                      </div>
                    ))}
                    {filteredScans.length > 200 && (
                      <div style={{ color: REPORT_COLORS.textMuted, fontSize: 12, padding: '6px 2px' }}>
                        Showing the newest 200 of {filteredScans.length}. The PDF export carries up to 400.
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}

function NumberCell({ children }) {
  return (
    <td style={{
      padding: '9px 8px',
      textAlign: 'right',
      color: REPORT_COLORS.textSecondary,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </td>
  );
}
