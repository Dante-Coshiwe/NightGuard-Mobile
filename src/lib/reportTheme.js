// ============================================================================
//  Report design tokens.
//
//  Kept out of ReportKit.jsx on purpose: a file that exports both components and
//  plain values breaks Fast Refresh (react-refresh/only-export-components), and
//  every report screen wants the colours without pulling in the components.
//
//  Palette note. The app's chart surface is #0a0a0a. The three categorical slots
//  are the validated dark steps for that surface — worst adjacent pair is CVD ΔE
//  9.4 (deutan) and normal-vision ΔE 26.5, all three ≥3:1 contrast, so series stay
//  tellable apart for colour-blind readers. Assign them in this fixed order and
//  never cycle past the third; a fourth series folds into "Other" or gets its own
//  chart. Status colours are RESERVED for state and always ship with a word beside
//  them, so colour is never the only channel carrying the meaning.
// ============================================================================

export const REPORT_COLORS = {
  page: '#000',
  surface: '#0a0a0a',
  surfaceRaised: '#111',
  border: '#1f1f1f',
  borderStrong: '#2a2a2a',
  textPrimary: '#fff',
  textSecondary: '#a1a1aa',
  textMuted: '#6b6b70',
  // Categorical slots — fixed order, never cycled.
  series1: '#3987e5',
  series2: '#d95926',
  series3: '#199e70',
  // Sequential (magnitude) — one hue; the track is a darker step of the same ramp
  // so a bar and its empty space read as one scale.
  rampFill: '#3987e5',
  rampTrack: '#16273b',
  // Reserved status.
  good: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
  accent: '#dc2626',
};

export const STATUS_TONES = {
  good: { fg: '#86efac', bg: '#052e16', border: '#166534' },
  warning: { fg: '#fcd34d', bg: '#2b1c02', border: '#854d0e' },
  critical: { fg: '#fca5a5', bg: '#2a0a0a', border: '#7f1d1d' },
  neutral: { fg: '#c7c7cc', bg: '#141414', border: '#2a2a2a' },
  info: { fg: '#93c5fd', bg: '#0b1c31', border: '#1e40af' },
};

export const reportPageStyle = {
  padding: 16,
  color: REPORT_COLORS.textPrimary,
  background: REPORT_COLORS.page,
  minHeight: '100vh',
  boxSizing: 'border-box',
};

export const textControlStyle = {
  padding: '8px 10px',
  background: REPORT_COLORS.surfaceRaised,
  border: `1px solid ${REPORT_COLORS.borderStrong}`,
  borderRadius: 8,
  color: REPORT_COLORS.textPrimary,
  fontSize: 13,
  minWidth: 0,
};
