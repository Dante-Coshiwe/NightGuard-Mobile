import React from 'react';

// Shown only when a second handset has actually written to this site — see summariseDevices().
// On the normal one-device site it renders nothing at all, because there is nothing to
// disambiguate and the guard's screen should stay clean.

const formatWhen = (value) => (value
  ? new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '—');

export default function DeviceBreakdown({ summary, noun = 'entries' }) {
  if (!summary?.multiDevice) return null;

  const { breakdown, writingDeviceCount, hiddenFromMine } = summary;

  return (
    <div style={{
      marginTop: 20,
      background: '#0a0a0a',
      border: '1px solid #1f1f1f',
      borderRadius: 8,
      padding: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 4 }}>
        {writingDeviceCount} devices are filing {noun} on this site
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
        The list above is this device only
        {hiddenFromMine > 0 ? ` — ${hiddenFromMine} ${noun} from elsewhere are not shown there.` : '.'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {breakdown.map((row) => (
          <div
            key={row.key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
              paddingBottom: 8,
              borderBottom: '1px solid #141414',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#e5e5e5', wordBreak: 'break-all' }}>
                {row.name}
                {row.isThisDevice && (
                  <span style={{
                    marginLeft: 8,
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: '#1a1a1a',
                    color: '#9ca3af',
                  }}>
                    this device
                  </span>
                )}
              </div>
              {row.note && <div style={{ fontSize: 11, color: '#555' }}>{row.note}</div>}
            </div>
            <div style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
              {row.count} {row.count === 1 ? noun.replace(/s$/, '') : noun} · last {formatWhen(row.lastAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
