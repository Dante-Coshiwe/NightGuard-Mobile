import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getRecentOBEntries } from '../services/api';
import { buildDatedReportFileName, exportPdfDocument } from '../lib/reportUtils';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './OBScreen.css';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { isAppOnline } from '../lib/connectivity';
import { getCachedSiteSettings, getShiftSession } from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';
import { getCachedObEntries, setCachedObEntries } from '../lib/reportCache';
import { summariseDevices } from '../lib/deviceAttribution';
import { getCurrentDeviceRecord } from '../services/schemaData';
import DeviceBreakdown from '../components/DeviceBreakdown';

export default function OBScreen() {
  const { user, shiftSession } = useAuth();
  const [entries, setEntries] = useState([]);
  const [newEntry, setNewEntry] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Kept apart from `error`, which belongs to the form. A background refresh failing must not
  // wipe "Nature of Occurrence cannot be empty" out from under the guard, and vice versa.
  const [listError, setListError] = useState('');
  const [success, setSuccess] = useState('');
  // Bumped the moment a save starts. A refresh whose fetch was already in flight is answering a
  // question from before that save, so applying it would drop the entry the guard just wrote off
  // the list AND out of the cache — see loadEntries.
  const submitSeq = useRef(0);
  const { post } = useOfflineApi();

  useEffect(() => {
    loadEntries();
  }, []);

  // `silent` is the difference between opening the page and refreshing it. Only the first paint
  // may show "Loading entries…" — see useLiveRefresh for why a refresh must never take the list
  // away, and how often it would otherwise have done so.
  const loadEntries = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const seq = submitSeq.current;

    // The cache first, always and whatever the connection is doing. The occurrence book is
    // readable the instant the page opens, with no signal and before any network work starts.
    let cached = [];
    try {
      cached = await getCachedObEntries();
    } catch (err) {
      console.error('[OBScreen] Could not read the cached occurrence book:', err);
    }

    if (!silent && cached.length) {
      setEntries(cached);
      setLoading(false);
    }

    try {
      if (!isAppOnline()) {
        setEntries(cached);
        return;
      }

      const result = await getRecentOBEntries();

      // A save started while this was in flight. Its optimistic write is newer than anything this
      // answer can contain, so this one is thrown away rather than written over it.
      if (submitSeq.current !== seq) return;

      const data = result || [];

      // Keep queued/offline items visible until the server's own copy replaces them.
      const offlineItems = (cached || []).filter((i) => i?._offline);
      const remoteIds = new Set(data.map((i) => String(i?.id)));
      const merged = [
        ...offlineItems.filter((i) => !remoteIds.has(String(i?.id))),
        ...data,
      ];

      setEntries(merged);
      setListError('');
      await setCachedObEntries(merged);

    } catch (err) {
      console.error('[OBScreen] Failed to load entries:', err);

      // Never blank the list because a refresh failed — what is on screen is still true, and
      // offline is the expected condition on a guard's handset, not a fault worth shouting about.
      if (cached.length) {
        setEntries(cached);
      } else if (!silent) {
        setListError('Could not load entries — nothing is saved on this device yet.');
      }

    } finally {
      setLoading(false);
    }
  };

  useLiveRefresh(() => loadEntries({ silent: true }));

  // Whose entries are these? On a one-handset site this is a no-op — `mine` is every row and the
  // breakdown renders nothing. It only bites when a second device starts writing here.
  const deviceSummary = useMemo(() => summariseDevices(entries, {
    deviceRowId: getCurrentDeviceRecord()?.id || null,
    devices: getCachedSiteSettings()?.devices || [],
    timestampKey: 'captured_timestamp',
  }), [entries]);
  const visibleEntries = deviceSummary.mine;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newEntry.trim()) {
      setError('Nature of Occurrence cannot be empty');
      return;
    }
    setError('');
    setSuccess('');
    setSubmitting(true);
    submitSeq.current += 1;
    try {
      const clientTempId = `ob_${Date.now()}`;
      // Stamp when the guard actually wrote the entry. This used to live only in offlineResponse
      // (the optimistic on-screen copy), so the payload carried no timestamp and createObEntry
      // fell back to now() — an entry written offline was filed at whatever time the queue
      // happened to drain, which for an occurrence book is the one field that has to be right.
      const capturedAt = new Date().toISOString();
      const result = await post('/obentries/create', {
        site_id: getCachedSiteSettings().id || null,
        shift_id: shiftSession?.id || getShiftSession()?.id || null,
        captured_by: user?.id || null,
        guard_id: user?.id || null,
        nature_of_occurrence: newEntry.trim(),
        captured_timestamp: capturedAt,
      }, {
        clientTempId,
        offlineResponse: {
          id: clientTempId,
          serial_number: `OFF-${Date.now().toString().slice(-6)}`,
          nature_of_occurrence: newEntry.trim(),
          captured_timestamp: capturedAt,
          _offline: true,
        },
      });
      const updated = [result, ...entries];
      setEntries(updated);
      await setCachedObEntries(updated);
      setNewEntry('');
      setSuccess(result._offline ? 'Entry saved offline and queued for sync' : 'Entry saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving entry');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const handleExportPDF = async () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getCachedSiteSettings()?.name || 'UNKNOWN SITE';  // ← changed

    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(`OB Report - ${siteName}`, 14, 16);

    doc.setFontSize(9);
    doc.setTextColor(100);
    // Export what is on screen, not everything held. When a second handset is writing here the
    // list is filtered to this device, and a PDF that quietly included the other one would not
    // match the book the guard just read.
    doc.text(
      `Exported: ${new Date().toLocaleString()} | Total entries: ${visibleEntries.length}`
        + (deviceSummary.multiDevice ? ' | This device only' : ''),
      14,
      23
    );

    doc.autoTable({
      head: [['Serial No.', 'Date / Time', 'Nature of Occurrence', 'Guard', 'Location']],
      body: visibleEntries.map((entry) => [
        entry.serial_number || '-',
        formatDateTime(entry.captured_timestamp),
        entry.nature_of_occurrence || '-',
      ]),
      startY: 28,
      styles: { fontSize: 9, cellPadding: 4, textColor: 0, lineColor: 200, lineWidth: 0.3 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 42 },
        2: { cellWidth: 110 },
      },
      margin: { top: 28, right: 14, bottom: 14, left: 14 },
    });

    await exportPdfDocument(doc, buildDatedReportFileName('OB-Report'), {
      shareTitle: 'OB Report',
      shareText: 'NightGuard occurrence book report.',
      preferShare: true,
    });
  };

  return (
    <div className="ob-container">
      <div className="ob-header">
        <h1>Occurrence Book</h1>
      </div>

      <div className="ob-form-section">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Nature of Occurrence</label>
            <textarea
              className="form-textarea"
              placeholder="Enter the nature of occurrence..."
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              disabled={submitting}
              rows="4"
            />
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <button type="submit" className="button-save" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Entry'}
          </button>
        </form>
      </div>

      <div className="ob-list-section">
        <h2>Entries</h2>
        {listError && <div className="error-message">{listError}</div>}
        {loading && visibleEntries.length === 0 ? (
          <div className="loading-message">Loading entries...</div>
        ) : visibleEntries.length === 0 ? (
          <div className="empty-message">No entries yet</div>
        ) : (
          <div className="entries-list">
            {visibleEntries.map((entry) => (
              <div key={entry.id} className="entry-card">
                <div className="entry-header">
                  <div className="entry-serial">{entry.serial_number}</div>
                  <div className="entry-datetime">{formatDateTime(entry.captured_timestamp)}</div>
                </div>
                <div className="entry-nature">{entry.nature_of_occurrence}</div>
              </div>
            ))}
          </div>
        )}

        <DeviceBreakdown summary={deviceSummary} noun="entries" />
      </div>

      <div className="ob-footer">
        <button className="button-export" onClick={handleExportPDF} disabled={visibleEntries.length === 0}>
          Export PDF
        </button>
      </div>
    </div>
  );
}
