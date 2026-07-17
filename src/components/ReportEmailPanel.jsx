import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getCachedSiteSettings, getDeviceId, getLastSyncAt, getLocationName, getReportEmailSetting } from '../lib/deviceStore';
import { loadReportSchedules, saveReportSchedule } from '../services/schemaData';

function buildMailtoUrl({ recipients, subject, body }) {
  const query = new URLSearchParams({
    subject,
    body,
  });
  return `mailto:${recipients}?${query.toString()}`;
}

export default function ReportEmailPanel({ reportKey, reportLabel, onShareReport }) {
  const { user } = useAuth();
  const isAdmin = user?.user_type === 'admin' || user?.role === 'admin';
  const [settings, setSettings] = useState(getReportEmailSetting(reportKey));
  const [saved, setSaved] = useState('');
  const locationName = getLocationName();
  const boundEmail = localStorage.getItem('nightguard_bound_email') || '';
  const senderEmail = String(user?.email || boundEmail || '').trim();
  const senderMatchesBound = !boundEmail || !senderEmail || senderEmail.toLowerCase() === boundEmail.toLowerCase();

  const emailBody = useMemo(() => {
    const syncLabel = getLastSyncAt() ? new Date(getLastSyncAt()).toLocaleString() : 'No sync recorded yet';
    return [
      `${reportLabel}`,
      '',
      `Location: ${locationName}`,
      `Device ID: ${getDeviceId()}`,
      `Last Sync: ${syncLabel}`,
      `Bound Sender Email: ${senderEmail || 'Not available'}`,
      '',
      'This report was prepared from the NightGuard device.',
      senderEmail ? `Use the bound sender account ${senderEmail} when sending this report.` : 'Sign in with the admin email that should send this report.',
      'Open the app to view or export the full report details.',
    ].join('\n');
  }, [locationName, reportLabel, senderEmail]);

  if (!isAdmin) return null;

  useEffect(() => {
    loadReportSchedules(getCachedSiteSettings()).catch(() => null);

    const handleSchedulesUpdate = () => {
      setSettings(getReportEmailSetting(reportKey));
    };

    window.addEventListener('nightguard_report_schedules_updated', handleSchedulesUpdate);
    return () => window.removeEventListener('nightguard_report_schedules_updated', handleSchedulesUpdate);
  }, [reportKey]);

  const updateSettings = async (next) => {
    setSettings(next);
    try {
      const result = await saveReportSchedule(reportKey, next, getCachedSiteSettings());
      setSaved(result?._offline ? 'Saved locally' : 'Saved');
    } catch (err) {
      setSaved(err.message || 'Save failed');
    }
    window.setTimeout(() => setSaved(''), 1500);
  };

  const handleEmailOpen = () => {
    const recipients = settings.recipients.trim();
    if (!recipients) {
      setSaved('Add recipient emails first');
      window.setTimeout(() => setSaved(''), 1800);
      return;
    }

    const subject = settings.subject?.trim() || `${locationName} ${reportLabel}`;
    if (!senderEmail) {
      setSaved('Log in with the email account that must send this report');
      window.setTimeout(() => setSaved(''), 2200);
      return;
    }
    if (!senderMatchesBound) {
      setSaved('Current profile email does not match the device-bound admin email');
      window.setTimeout(() => setSaved(''), 2200);
      return;
    }

    if (onShareReport) {
      Promise.resolve(onShareReport({
        recipients,
        subject,
        body: emailBody,
        senderEmail,
      }))
        .then(() => {
          setSaved('Report prepared');
          window.setTimeout(() => setSaved(''), 1800);
        })
        .catch((err) => {
          setSaved(err.message || 'Could not prepare report');
          window.setTimeout(() => setSaved(''), 2200);
        });
      return;
    }

    window.location.href = buildMailtoUrl({
      recipients,
      subject,
      body: emailBody,
    });
  };

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, color: '#fff' }}>Email delivery</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>Report email settings for location admin only.</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: senderMatchesBound ? '#86efac' : '#fca5a5' }}>
            Sender account: {senderEmail || 'Not signed in'}{boundEmail ? ` | Device bound: ${boundEmail}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => updateSettings({ ...settings, enabled: !settings.enabled })}
            style={{ padding: '8px 14px', background: settings.enabled ? '#dc2626' : '#18181b', border: '1px solid #333', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 }}
          >
            {settings.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button
            onClick={handleEmailOpen}
            style={{ padding: '8px 14px', background: '#18181b', border: '1px solid #333', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 }}
          >
            {onShareReport ? 'Send Report' : 'Open Email'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Time</div>
          <input
            type="time"
            value={settings.time}
            onChange={(e) => updateSettings({ ...settings, time: e.target.value })}
            style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', boxSizing: 'border-box' }}
          />
        </label>
        <label>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Subject</div>
          <input
            type="text"
            value={settings.subject}
            onChange={(e) => updateSettings({ ...settings, subject: e.target.value })}
            placeholder={`${locationName} ${reportLabel}`}
            style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Recipient emails</div>
          <input
            type="text"
            value={settings.recipients}
            onChange={(e) => updateSettings({ ...settings, recipients: e.target.value })}
            placeholder="ops@example.com, admin@example.com"
            style={{ width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', boxSizing: 'border-box' }}
          />
        </label>
      </div>

      {saved && <div style={{ color: '#86efac', fontSize: 12, marginTop: 10 }}>{saved}</div>}
    </div>
  );
}
