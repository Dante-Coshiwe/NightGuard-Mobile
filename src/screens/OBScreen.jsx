import React, { useState, useEffect } from 'react';
import { getRecentOBEntries } from '../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './OBScreen.css';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';
import { getCachedSiteSettings, getShiftSession } from '../lib/deviceStore';
import { useAuth } from '../contexts/AuthContext';
import { getCachedObEntries, setCachedObEntries } from '../lib/reportCache';

export default function OBScreen() {
  const { user, shiftSession } = useAuth();
  const [entries, setEntries] = useState([]);
  const [newEntry, setNewEntry] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { post } = useOfflineApi();

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    setLoading(true);

    try {
      if (!navigator.onLine) {
        // Load from cache if offline
        const cached = await getCachedObEntries();
        setEntries(cached);
        return;
      }

      const result = await getRecentOBEntries();
      const data = result || [];

      // When coming online, keep queued/offline items visible until they are replaced.
      const cached = await getCachedObEntries();
      const offlineItems = (cached || []).filter((i) => i?._offline);
      const remoteIds = new Set(data.map((i) => String(i?.id)));
      const merged = [
        ...offlineItems.filter((i) => !remoteIds.has(String(i?.id))),
        ...data,
      ];

      setEntries(merged);
      await setCachedObEntries(merged);

    } catch (err) {
      setError('Error loading entries');
      console.error(err);

      // Fallback to cache on error
      const cached = await getCachedObEntries();
      setEntries(cached);

    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onSyncComplete = () => {
      loadEntries();
    };
    const handleOnline = () => {
      console.log('[OBScreen] Coming online - reloading OB entries from server');
      loadEntries();
    };
    window.addEventListener('nightguard_sync_complete', onSyncComplete);
    window.addEventListener('online', handleOnline);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    return () => {
      window.removeEventListener('nightguard_sync_complete', onSyncComplete);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newEntry.trim()) {
      setError('Nature of Occurrence cannot be empty');
      return;
    }
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const clientTempId = `ob_${Date.now()}`;
      const result = await post('/obentries/create', {
        site_id: getCachedSiteSettings().id || null,
        shift_id: shiftSession?.id || getShiftSession()?.id || null,
        captured_by: user?.id || null,
        guard_id: user?.id || null,
        nature_of_occurrence: newEntry.trim(),
      }, {
        clientTempId,
        offlineResponse: {
          id: clientTempId,
          serial_number: `OFF-${Date.now().toString().slice(-6)}`,
          nature_of_occurrence: newEntry.trim(),
          captured_timestamp: new Date().toISOString(),
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

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const siteName = getCachedSiteSettings()?.name || 'UNKNOWN SITE';  // ← changed

    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(`OB Report - ${siteName}`, 14, 16);

    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(
      `Exported: ${new Date().toLocaleString()} | Total entries: ${entries.length}`,
      14,
      23
    );

    doc.autoTable({
      head: [['Serial No.', 'Date / Time', 'Nature of Occurrence', 'Guard', 'Location']],
      body: entries.map((entry) => [
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

    doc.save(`OB-Report-${new Date().toISOString().split('T')[0]}.pdf`);
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
        {loading ? (
          <div className="loading-message">Loading entries...</div>
        ) : entries.length === 0 ? (
          <div className="empty-message">No entries yet</div>
        ) : (
          <div className="entries-list">
            {entries.map((entry) => (
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
      </div>

      <div className="ob-footer">
        <button className="button-export" onClick={handleExportPDF} disabled={entries.length === 0}>
          Export PDF
        </button>
      </div>
    </div>
  );
}
