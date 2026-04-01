import React, { useState, useEffect } from 'react';
import { getRecentOBEntries, createOBEntry } from '../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import './OBScreen.css';

export default function OBScreen() {
  const [entries, setEntries] = useState([]);
  const [newEntry, setNewEntry] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load entries on mount
  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const result = await getRecentOBEntries();
      if (result.success) {
        setEntries(result.data || []);
      } else {
        setError('Failed to load entries');
      }
    } catch (err) {
      setError('Error loading entries');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    if (!newEntry.trim()) {
      setError('Nature of Occurrence cannot be empty');
      return;
    }

    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      const result = await createOBEntry(newEntry.trim());
      if (result.success) {
        // Add new entry to top of list
        setEntries([result.data, ...entries]);
        setNewEntry('');
        setSuccess('Entry saved successfully');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || 'Failed to save entry');
      }
    } catch (err) {
      setError('Error saving entry');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleExportPDF = () => {
    const siteName = import.meta.env.VITE_SITE_NAME || 'UNKNOWN SITE';
    const doc = new jsPDF();

    // Title
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text(`OB REPORT - SITE: ${siteName}`, 14, 20);

    // Export date/time
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const exportTime = new Date().toLocaleString();
    doc.text(`Exported: ${exportTime}`, 14, 30);

    // Table data
    const tableData = entries.map((entry) => [
      entry.serial_number || '',
      formatDateTime(entry.captured_timestamp),
      entry.nature_of_occurrence || '',
    ]);

    // Add table
    doc.autoTable({
      head: [['SERIAL NUMBER', 'DATE/TIME', 'NATURE OF OCCURRENCE']],
      body: tableData,
      startY: 40,
      styles: {
        fontSize: 9,
        cellPadding: 5,
        textColor: 0,
        lineColor: 180,
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: 50,
        textColor: 255,
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 40 },
        2: { cellWidth: 115 },
      },
      margin: { top: 40, right: 14, bottom: 14, left: 14 },
    });

    // Save file
    const dateStr = new Date().toISOString().split('T')[0];
    doc.save(`OB-Report-${dateStr}.pdf`);
  };

  return (
    <div className="ob-container">
      <div className="ob-header">
        <h1>Occurrence Book</h1>
      </div>

      {/* Form Section */}
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

          <button
            type="submit"
            className="button-save"
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Entry'}
          </button>
        </form>
      </div>

      {/* Entries List */}
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

      {/* PDF Export Button (Fixed at bottom) */}
      <div className="ob-footer">
        <button className="button-export" onClick={handleExportPDF} disabled={entries.length === 0}>
          Export PDF
        </button>
      </div>
    </div>
  );
}
