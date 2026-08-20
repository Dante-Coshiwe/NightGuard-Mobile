import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getMyReportRecipients } from '../services/api';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useAuth } from '../contexts/AuthContext';
import { getCachedReportRecipients, saveCachedReportRecipients } from '../lib/deviceStore';
import { getBoundSiteIdSync } from '../lib/siteResolver';

// ============================================================================
//  Report Emails — the addresses THIS SITE's automated reports are sent to.
//
//  A location admin signs in on the handset and sets the client's address for
//  the site the handset is standing on. The same rows are editable from the
//  dashboard; whichever writes last wins, which is correct — they are two ways
//  into one setting, not two settings.
//
//  ⚠ THE SITE IS NEVER CHOSEN ON THIS SCREEN. It is read from the device's own
//  binding, the same source every OB entry and incident on this handset uses.
//  An admin can hold several sites and sign in to any of them, so a site picker
//  here would be the one control capable of pointing one client's nightly
//  security record at another client's inbox. The site is shown, prominently,
//  and cannot be changed — if it is wrong, the fix is to re-bind the device,
//  not to override it on a settings form.
//
//  Offline: writes go through the offline queue like every other write on this
//  handset, and the screen reads its cache before it reads the network so it is
//  usable with no signal — which on a guard's phone is the normal condition.
// ============================================================================

const sectionStyle = { background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 12, padding: 24, marginBottom: 20 };

function Section({ title, children }) {
  return (
    <div style={sectionStyle}>
      <h2 style={{ color: '#666', fontSize: 15, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ color: '#999', fontSize: 12, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ color: '#666', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function inputStyle(readonly) {
  return {
    width: '100%',
    padding: '10px 12px',
    background: readonly ? '#0d0d0d' : '#111',
    border: `1px solid ${readonly ? '#1a1a1a' : '#2a2a2a'}`,
    borderRadius: 8,
    color: readonly ? '#555' : '#fff',
    fontSize: 14,
    boxSizing: 'border-box',
    cursor: readonly ? 'not-allowed' : 'text',
  };
}

function Toggle({ label, description, value, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0' }}>
      <div style={{ flex: 1, marginRight: 16 }}>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#555', fontSize: 12 }}>{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: value ? '#dc2626' : '#333', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
      >
        <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: value ? 23 : 3, transition: 'left 0.2s' }} />
      </button>
    </div>
  );
}

// Quarter hours only. The dispatcher is a cron tick every 15 minutes, so a finer
// time is a promise the system cannot keep — and this whole feature replaces a
// panel whose settings did nothing at all. Do not offer a free time field here.
const SEND_TIMES = (() => {
  const out = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

const hhmm = (value) => (value ? String(value).slice(0, 5) : '');

// Split on comma, semicolon or whitespace so a pasted list works however it was
// formatted. Anything that is not an address is REPORTED back, never silently
// dropped — quietly discarding a typo is how a client stops receiving reports
// with nobody finding out for weeks.
function parseEmailList(raw) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(part)) {
        invalid.push(part);
        return;
      }
      const key = part.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        valid.push(part);
      }
    });
  return { valid, invalid };
}

export default function ReportEmailConfig() {
  const { siteSettings } = useAuth();
  const { put } = useOfflineApi();

  const boundSiteId = getBoundSiteIdSync();
  const siteName = siteSettings?.site_name || siteSettings?.location_name || 'this location';

  // Primed straight from the cache in the initialiser, not in an effect. The screen is then
  // correct on its FIRST paint with no signal at all, and there is no flash of an empty form
  // that an admin could start typing into before the cached values arrive underneath them.
  const cached = getCachedReportRecipients(boundSiteId);

  const [record, setRecord] = useState(cached);
  // Seeded false when there is no site binding: there is nothing to fetch on that path, so the
  // screen must not open on a spinner that never resolves.
  const [loading, setLoading] = useState(Boolean(boundSiteId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [daily, setDaily] = useState(() => (cached?.recipient_emails || []).join(', '));
  const [immediate, setImmediate] = useState(() => (cached?.immediate_emails || []).join(', '));
  const [sendTime, setSendTime] = useState(() => hhmm(cached?.daily_send_time));
  const [isActive, setIsActive] = useState(() => (cached ? cached.is_active !== false : true));

  // Once the admin starts typing, a background refresh must not overwrite the
  // box under them. Same rule the OB screen learned the hard way when a refresh
  // wiped a half-typed entry.
  const dirtyRef = useRef(false);
  const initialisedRef = useRef(false);

  const applyRecord = useCallback((next) => {
    setRecord(next);
    if (dirtyRef.current) return;
    setDaily((next?.recipient_emails || []).join(', '));
    setImmediate((next?.immediate_emails || []).join(', '));
    setSendTime(hhmm(next?.daily_send_time));
    setIsActive(next ? next.is_active !== false : true);
    initialisedRef.current = true;
  }, []);

  // ⚠ NEVER RAISES `loading`. It only ever lowers it.
  //
  // This runs on mount AND on every sync/reconnect via useLiveRefresh, and those fire far more
  // often than they look — once per drained queue item, among other things. A loader that
  // starts with setLoading(true) swaps the whole form for "Loading…" each time, which on this
  // theme reads as the screen going black and coming back. That is the exact flicker the OB
  // and Incident screens were fixed for; the report screens never re-raised it and were always
  // fine. `loading` is seeded true by useState and cleared once, here.
  const load = useCallback(async (silent = false) => {
    if (!boundSiteId) return;
    try {
      const data = await getMyReportRecipients();
      saveCachedReportRecipients(data);
      applyRecord(data);
      setError('');
    } catch (err) {
      // A failed background read must not blank what is on screen — it is still
      // true, and offline is expected here rather than a fault worth shouting
      // about. Only say something when there is nothing to show at all.
      if (!silent && !getCachedReportRecipients(boundSiteId)) {
        setError(err.response?.data?.error || err.message || 'Could not load the email settings');
      }
    } finally {
      setLoading(false);
    }
  }, [boundSiteId, applyRecord]);

  // The fetch-on-mount every screen in this app does. The lint rule traces setLoading(false)
  // in load()'s `finally` and cannot see that it is unreachable until after the await, so it
  // reads an async data fetch as a synchronous cascading render. Nothing here sets state
  // before the first await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(useCallback(() => load(true), [load]));

  const handleSave = async () => {
    setError('');
    setSuccess('');

    const parsedDaily = parseEmailList(daily);
    const parsedImmediate = parseEmailList(immediate);
    const bad = [...parsedDaily.invalid, ...parsedImmediate.invalid];
    if (bad.length) {
      setError(`Not an email address: ${bad.join(', ')}`);
      return;
    }

    setSaving(true);
    const payload = {
      recipient_emails: parsedDaily.valid,
      immediate_emails: parsedImmediate.valid,
      daily_send_time: sendTime || null,
      is_active: isActive,
    };

    try {
      // The site_id is added server-side from the device binding — see
      // updateReportRecipientsRecord in services/api.js. It is deliberately not
      // in this payload: a site_id travelling through the offline queue could
      // be applied against a different binding by the time it drains.
      const result = await put('/report-recipients/mine', payload, {
        offlineResponse: {
          ...(record || {}),
          ...payload,
          site_id: boundSiteId,
          configured: true,
          _offline: true,
        },
      });

      dirtyRef.current = false;
      const saved = { ...(record || {}), ...payload, ...(result?._offline ? {} : result), site_id: boundSiteId };
      saveCachedReportRecipients(saved);
      applyRecord(saved);

      setSuccess(result?._offline
        ? 'Saved on this device — it will sync when the phone finds signal'
        : 'Saved. Reports will go to these addresses.');
      window.setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const markDirty = (setter) => (value) => {
    dirtyRef.current = true;
    setter(value);
  };

  // No site binding means there is nothing safe to edit. Saying so plainly beats
  // showing an empty form that writes somewhere unexpected.
  if (!boundSiteId) {
    return (
      <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: 'var(--app-viewport-height, 100dvh)', maxWidth: 700 }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 22 }}>Report Emails</h1>
        <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: 8, padding: '14px 16px', color: '#ff6b6b', fontSize: 13, lineHeight: 1.6 }}>
          This device is not bound to a location yet, so there is no site to set recipients for.
          Bind the device to a site first — report emails are always addressed to one location,
          and there is no safe default.
        </div>
      </div>
    );
  }

  if (loading && !record) {
    return <div style={{ padding: 32, color: '#666', textAlign: 'center' }}>Loading email settings…</div>;
  }

  const houseTime = hhmm(record?.house_send_time) || '06:00';
  const masterOff = record && record.emails_enabled === false;

  return (
    <div style={{ padding: '24px 32px', color: '#fff', background: '#000', minHeight: 'var(--app-viewport-height, 100dvh)', maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Report Emails</h1>
          <div style={{ marginTop: 6, color: '#8b8b8b', fontSize: 13 }}>
            Who receives this location&apos;s daily reports and incident alerts.
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '10px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* The site is stated before anything editable, because everything below is
          scoped to it and an admin who holds several sites has no other way to
          tell which one this handset is speaking for. */}
      <div style={{ background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: '#9ecbff' }}>
        These addresses receive <strong style={{ color: '#fff' }}>{siteName}</strong> records only.
        This device is bound to that location, and reports for other locations are never sent here.
      </div>

      {error && <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: 8, padding: '10px 16px', color: '#ff6b6b', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ background: '#0a2a1a', border: '1px solid #1a5a3a', borderRadius: 8, padding: '10px 16px', color: '#6bff9e', fontSize: 13, marginBottom: 16 }}>{success}</div>}

      {masterOff && (
        <div style={{ background: '#2a2010', border: '1px solid #5a4520', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#ffd08a', fontSize: 13, lineHeight: 1.6 }}>
          <strong>Automated email is switched off for the whole company right now.</strong> What you
          set here is saved and will be used the moment it is switched back on from the management
          dashboard — but nothing is being sent today.
        </div>
      )}

      <Section title="Daily Reports">
        <Field
          label="Send daily reports to"
          hint="Separate addresses with commas or new lines. These receive the incident, patrol and entry/exit reports for the previous day."
        >
          <textarea
            value={daily}
            onChange={(e) => markDirty(setDaily)(e.target.value)}
            rows={3}
            placeholder="client@example.com, manager@example.com"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{ ...inputStyle(false), resize: 'vertical' }}
          />
        </Field>

        <Field
          label={`Send at (${record?.timezone || 'Africa/Johannesburg'})`}
          hint={`Arrives within about 15 minutes of the time chosen. Leave on the house time to follow whatever the company default is — it is ${houseTime} now, and this location moves with it if it changes.`}
        >
          <select
            value={sendTime}
            onChange={(e) => markDirty(setSendTime)(e.target.value)}
            style={inputStyle(false)}
          >
            <option value="">House time ({houseTime})</option>
            {SEND_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Incident Alerts">
        <Field
          label="Send incident alerts to"
          hint="Optional. An incident is emailed the moment a guard captures it. Fill this in only when a different set of people should get a 03:00 alert than the morning report — it REPLACES the daily list for alerts rather than adding to it. Leave it empty and alerts go to the addresses above."
        >
          <textarea
            value={immediate}
            onChange={(e) => markDirty(setImmediate)(e.target.value)}
            rows={2}
            placeholder="Leave blank to use the daily recipients"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{ ...inputStyle(false), resize: 'vertical' }}
          />
        </Field>
        {record?.immediate_incident_enabled === false && (
          <div style={{ color: '#ffd08a', fontSize: 12, lineHeight: 1.5 }}>
            Immediate incident alerts are switched off company-wide, so nothing is sent on capture
            right now. Incidents still appear in the next daily report.
          </div>
        )}
      </Section>

      <Section title="Status">
        <Toggle
          label="Send reports for this location"
          description="Off pauses this location's reports without losing the addresses. Use it when a site is between contracts."
          value={isActive}
          onChange={markDirty(setIsActive)}
        />
        <div style={{ color: '#8b8b8b', fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          {record?.configured
            ? 'Saved on the server. The management dashboard shows every send attempt for this location, including the ones that failed.'
            : 'Not set up yet — no reports are being emailed for this location.'}
        </div>
      </Section>
    </div>
  );
}
