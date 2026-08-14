import React from 'react';
import { REPORT_COLORS, STATUS_TONES, textControlStyle as controlStyle } from '../lib/reportTheme';

// ============================================================================
//  Shared report furniture.
//
//  The four report screens each grew their own stat tiles, their own filter row and
//  their own idea of what "no data" looks like, so the same number could appear in
//  two shapes on two pages and a guard had to relearn each screen. Everything visual
//  that more than one report needs lives here, once. Colours and plain style objects
//  live in lib/reportTheme.js — see the palette note there.
// ============================================================================

export function StatusPill({ tone = 'neutral', children, title }) {
  const colors = STATUS_TONES[tone] || STATUS_TONES.neutral;
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: colors.fg,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// One headline number. `hint` is what stops a tile being a mystery — every tile on
// every report says in plain words what it counts and over what period.
export function StatTile({ label, value, hint, tone }) {
  const valueColor = tone ? (STATUS_TONES[tone]?.fg || REPORT_COLORS.textPrimary) : REPORT_COLORS.textPrimary;
  return (
    <div style={{
      background: REPORT_COLORS.surface,
      border: `1px solid ${REPORT_COLORS.border}`,
      borderRadius: 12,
      padding: 14,
      minWidth: 0,
    }}>
      <div style={{ color: REPORT_COLORS.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: valueColor, fontSize: 24, fontWeight: 700, lineHeight: 1.15, wordBreak: 'break-word' }}>
        {value}
      </div>
      {hint && <div style={{ color: REPORT_COLORS.textMuted, fontSize: 11, marginTop: 6, lineHeight: 1.35 }}>{hint}</div>}
    </div>
  );
}

export function KpiRow({ children, min = 150 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      gap: 10,
      marginBottom: 18,
    }}>
      {children}
    </div>
  );
}

// A single ratio against a limit. The fill carries severity; the track is a darker
// step of the same ramp so the whole bar reads as one scale.
export function Meter({ percent, label, caption, severityAt = { warning: 75, critical: 50 } }) {
  const safe = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  const fill = safe === null
    ? REPORT_COLORS.textMuted
    : safe >= severityAt.warning
      ? REPORT_COLORS.good
      : safe >= severityAt.critical
        ? REPORT_COLORS.warning
        : REPORT_COLORS.critical;

  return (
    <div style={{
      background: REPORT_COLORS.surface,
      border: `1px solid ${REPORT_COLORS.border}`,
      borderRadius: 12,
      padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ color: REPORT_COLORS.textSecondary, fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ color: REPORT_COLORS.textPrimary, fontSize: 22, fontWeight: 700 }}>
          {safe === null ? 'n/a' : `${Math.round(safe)}%`}
        </span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: REPORT_COLORS.rampTrack, overflow: 'hidden' }}>
        <div style={{
          width: `${safe === null ? 0 : safe}%`,
          height: '100%',
          background: fill,
          borderRadius: '0 5px 5px 0',
          transition: 'width 0.4s ease',
        }}
        />
      </div>
      {caption && <div style={{ color: REPORT_COLORS.textMuted, fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>{caption}</div>}
    </div>
  );
}

// Horizontal magnitude bars — one hue, value at the tip, no gridlines. Rows are
// capped at 24px and separated by real space rather than by strokes.
export function BarList({ rows = [], color = REPORT_COLORS.rampFill, formatValue = (value) => value, emptyText = 'Nothing recorded' }) {
  if (!rows.length) {
    return <div style={{ color: REPORT_COLORS.textMuted, fontSize: 13, padding: '10px 0' }}>{emptyText}</div>;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((row) => (
        <div key={row.key || row.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(72px, 34%) 1fr auto', gap: 10, alignItems: 'center' }}>
          <span style={{ color: REPORT_COLORS.textSecondary, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.label}
          </span>
          <span style={{ display: 'block', height: 12, background: REPORT_COLORS.rampTrack, borderRadius: 4 }}>
            <span style={{
              display: 'block',
              height: '100%',
              width: `${Math.max((Number(row.value) || 0) / max * 100, (Number(row.value) ? 3 : 0))}%`,
              background: row.color || color,
              borderRadius: '0 4px 4px 0',
            }}
            />
          </span>
          <span style={{ color: REPORT_COLORS.textPrimary, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>
            {formatValue(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Panel({ title, subtitle, right, children, style }) {
  return (
    <section style={{
      background: REPORT_COLORS.surface,
      border: `1px solid ${REPORT_COLORS.border}`,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      ...style,
    }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: subtitle ? 4 : 12, flexWrap: 'wrap' }}>
          {title && <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: REPORT_COLORS.textPrimary }}>{title}</h2>}
          {right}
        </div>
      )}
      {subtitle && <p style={{ margin: '0 0 12px', color: REPORT_COLORS.textMuted, fontSize: 12, lineHeight: 1.45 }}>{subtitle}</p>}
      {children}
    </section>
  );
}

// Says where the numbers came from and how old they are. A report that silently
// serves month-old cached rows is worse than one that admits it.
export function DataFreshness({ online, generatedAt, note }) {
  const tone = online ? 'good' : 'warning';
  const stamp = generatedAt ? new Date(generatedAt).toLocaleString() : null;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 14,
      color: REPORT_COLORS.textMuted,
      fontSize: 12,
    }}>
      <StatusPill tone={tone}>{online ? 'Live data' : 'Offline — saved on this device'}</StatusPill>
      {stamp && <span>Loaded {stamp}</span>}
      {note && <span>· {note}</span>}
    </div>
  );
}

export function ReportHeader({ title, purpose, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ minWidth: 200, flex: 1 }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: REPORT_COLORS.textPrimary }}>{title}</h1>
        {/* Every report says what it is FOR. Two reports over the same table look like
            duplicates until the reader is told which question each one answers. */}
        {purpose && <p style={{ margin: '5px 0 0', color: REPORT_COLORS.textSecondary, fontSize: 13, lineHeight: 1.45 }}>{purpose}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

// One action per report: build the PDF and hand it to the phone's share sheet, where
// the admin picks WhatsApp, Gmail, Drive or Files.
//
// This replaced an "Email delivery" panel that promised something the app could not
// do. It collected recipients, a subject and a send TIME — the shape of a scheduled
// mailout — and wrote them to a `report_schedules` table nothing ever read. Its Send
// button did not send: it opened this same share sheet and pasted the recipient list
// into the message body as text. An admin who typed the client's address in and
// switched it to Enabled had every reason to believe reports were going out nightly.
// They never were. A share sheet that says what it is beats a mail form that lies.
export function ShareButton({ onClick, disabled, busy, children = 'Share PDF' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        padding: '9px 16px',
        background: disabled || busy ? '#3f1414' : REPORT_COLORS.accent,
        color: disabled || busy ? '#9b8080' : '#fff',
        border: 'none',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
      }}
    >
      {busy ? 'Preparing PDF…' : children}
    </button>
  );
}

// One filter row, identical on every report, with named presets so the common
// question ("last week", "this month") is one tap rather than two date pickers.
export function DateRangeFilter({ from, to, onFrom, onTo, presets = true, extra }) {
  const applyPreset = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    onFrom(start.toISOString().slice(0, 10));
    onTo(end.toISOString().slice(0, 10));
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
      {extra}
      <input type="date" value={from} onChange={(event) => onFrom(event.target.value)} style={controlStyle} aria-label="From date" />
      <span style={{ color: REPORT_COLORS.textMuted, fontSize: 12 }}>to</span>
      <input type="date" value={to} onChange={(event) => onTo(event.target.value)} style={controlStyle} aria-label="To date" />
      {presets && [
        { label: '7 days', days: 7 },
        { label: '30 days', days: 30 },
      ].map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => applyPreset(preset.days)}
          style={{ ...controlStyle, color: REPORT_COLORS.textSecondary, cursor: 'pointer', padding: '8px 12px' }}
        >
          {preset.label}
        </button>
      ))}
      {(from || to) && (
        <button
          type="button"
          onClick={() => { onFrom(''); onTo(''); }}
          style={{ ...controlStyle, color: REPORT_COLORS.textMuted, cursor: 'pointer', padding: '8px 12px' }}
        >
          All time
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, detail }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '32px 16px',
      color: REPORT_COLORS.textMuted,
      background: REPORT_COLORS.surface,
      border: `1px dashed ${REPORT_COLORS.borderStrong}`,
      borderRadius: 12,
    }}>
      <div style={{ color: REPORT_COLORS.textSecondary, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {detail && <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 380, margin: '0 auto' }}>{detail}</div>}
    </div>
  );
}

