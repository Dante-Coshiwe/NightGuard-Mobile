import React from 'react';
import { hasCoordinates } from '../lib/geo';

// Lightweight, dependency-free checkpoint diagram. Plots GPS checkpoints (and optionally
// recorded check-in positions) on a normalised coordinate grid so admins/managers can see the
// patrol layout without loading any external map tiles — works fully offline.

const VIEW_W = 320;
const VIEW_H = 220;
const PAD = 26;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeBounds(points) {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  // Pad a single point (or a degenerate line) so it renders in the centre.
  if (minLat === maxLat) { minLat -= 0.0005; maxLat += 0.0005; }
  if (minLng === maxLng) { minLng -= 0.0005; maxLng += 0.0005; }

  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  return {
    minLat: minLat - latSpan * 0.1,
    maxLat: maxLat + latSpan * 0.1,
    minLng: minLng - lngSpan * 0.1,
    maxLng: maxLng + lngSpan * 0.1,
  };
}

export default function CheckpointMap({ checkpoints = [], scans = [], route = [], selectedId = null, reachedIds = [], onSelect = null, title = 'Checkpoint layout' }) {
  const reachedSet = new Set((Array.isArray(reachedIds) ? reachedIds : []).map((id) => String(id)));
  const interactive = typeof onSelect === 'function';
  const gpsCheckpoints = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter(hasCoordinates)
    .map((cp, index) => ({
      ...cp,
      latitude: toNumber(cp.latitude),
      longitude: toNumber(cp.longitude),
      order: cp.checkpoint_order ?? index + 1,
      label: cp.name || cp.checkpoint_name || `Point ${index + 1}`,
      reached: reachedSet.has(String(cp.id)),
    }));

  const gpsScans = (Array.isArray(scans) ? scans : [])
    .filter(hasCoordinates)
    .map((s) => ({ latitude: toNumber(s.latitude), longitude: toNumber(s.longitude) }));

  const routePoints = (Array.isArray(route) ? route : [])
    .filter(hasCoordinates)
    .map((p) => ({ latitude: toNumber(p.latitude), longitude: toNumber(p.longitude) }));

  const nfcOnly = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter((cp) => !hasCoordinates(cp) && (interactive || cp.tag_uid))
    .map((cp, index) => ({ id: cp.id, label: cp.name || cp.checkpoint_name || `Point ${index + 1}`, tag_uid: cp.tag_uid, zone: cp.zone }));

  const hasGps = gpsCheckpoints.length > 0 || routePoints.length > 1;
  const bounds = hasGps ? computeBounds([...gpsCheckpoints, ...gpsScans, ...routePoints]) : null;

  const project = (lat, lng) => {
    const x = PAD + ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (VIEW_W - PAD * 2);
    // Latitude grows northwards, so invert Y so north is up.
    const y = PAD + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * (VIEW_H - PAD * 2);
    return { x, y };
  };

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ color: '#d4d4d4', fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#8b8b8b', flexWrap: 'wrap' }}>
          {routePoints.length > 1 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: '#60a5fa', display: 'inline-block' }} /> Walked route
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#22c55e', display: 'inline-block' }} /> {reachedSet.size > 0 ? 'Reached' : 'GPS checkpoint'}
          </span>
          {reachedSet.size > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#3f9c5f', display: 'inline-block' }} /> Pending
            </span>
          )}
          {interactive && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#f59e0b', display: 'inline-block' }} /> Selected
            </span>
          )}
          {gpsScans.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#3b82f6', display: 'inline-block' }} /> Check-in
            </span>
          )}
        </div>
      </div>

      {hasGps ? (
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" aria-label="Checkpoint map" style={{ display: 'block', background: '#070707', borderRadius: 8 }}>
          {/* grid */}
          {[0.25, 0.5, 0.75].map((f) => (
            <g key={f} stroke="#1a1a1a" strokeWidth="1">
              <line x1={PAD + f * (VIEW_W - PAD * 2)} y1={PAD} x2={PAD + f * (VIEW_W - PAD * 2)} y2={VIEW_H - PAD} />
              <line x1={PAD} y1={PAD + f * (VIEW_H - PAD * 2)} x2={VIEW_W - PAD} y2={PAD + f * (VIEW_H - PAD * 2)} />
            </g>
          ))}

          {/* walked route trail */}
          {routePoints.length > 1 && (() => {
            const pathPoints = routePoints.map((p) => project(p.latitude, p.longitude));
            const d = pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            const start = pathPoints[0];
            const end = pathPoints[pathPoints.length - 1];
            return (
              <g>
                <path d={d} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
                <circle cx={start.x} cy={start.y} r="4" fill="#0b1d33" stroke="#60a5fa" strokeWidth="1.5" />
                <circle cx={end.x} cy={end.y} r="4" fill="#60a5fa" stroke="#dbeafe" strokeWidth="1.5" />
              </g>
            );
          })()}

          {/* check-in dots */}
          {gpsScans.map((s, i) => {
            const { x, y } = project(s.latitude, s.longitude);
            return <circle key={`scan-${i}`} cx={x} cy={y} r="3.5" fill="#3b82f6" opacity="0.7" />;
          })}

          {/* checkpoint markers */}
          {gpsCheckpoints.map((cp, i) => {
            const { x, y } = project(cp.latitude, cp.longitude);
            const isSelected = selectedId != null && String(cp.id) === String(selectedId);
            const fill = cp.reached ? '#22c55e' : isSelected ? '#f59e0b' : '#3f9c5f';
            const stroke = isSelected ? '#fbbf24' : cp.reached ? '#065f46' : '#065f46';
            return (
              <g
                key={cp.id || `cp-${i}`}
                onClick={interactive ? () => onSelect(cp.id) : undefined}
                style={interactive ? { cursor: 'pointer' } : undefined}
              >
                {isSelected && <circle cx={x} cy={y} r="12" fill="none" stroke="#fbbf24" strokeWidth="1.5" opacity="0.8" />}
                <circle cx={x} cy={y} r={isSelected ? 9 : 8} fill={fill} stroke={stroke} strokeWidth={isSelected ? 2 : 1.5} />
                <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="#04220f">{cp.order}</text>
                <text x={x} y={y - 12} textAnchor="middle" fontSize="9" fill={isSelected ? '#fde68a' : '#d4d4d4'}>{cp.label.slice(0, 16)}</text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ color: '#8b8b8b', fontSize: 13, padding: '18px 6px', textAlign: 'center' }}>
          {interactive
            ? 'No pins dropped yet. Pick a point above, then drop a pin at its location.'
            : 'No GPS checkpoints set yet. Add coordinates to a checkpoint to see it here.'}
        </div>
      )}

      {nfcOnly.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: '#a3a3a3', fontSize: 12, marginBottom: 6 }}>
            {interactive ? `Points without a pin (${nfcOnly.length}) — tap to select, then drop a pin` : `NFC-only points (${nfcOnly.length})`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {nfcOnly.map((cp, i) => {
              const isSelected = selectedId != null && String(cp.id) === String(selectedId);
              return (
                <span
                  key={cp.id || i}
                  onClick={interactive && cp.id != null ? () => onSelect(cp.id) : undefined}
                  style={{
                    fontSize: 11,
                    color: isSelected ? '#fde68a' : '#93c5fd',
                    background: isSelected ? '#3a2a06' : '#0b1d33',
                    border: `1px solid ${isSelected ? '#b45309' : '#1e3a5f'}`,
                    borderRadius: 999,
                    padding: '3px 9px',
                    cursor: interactive && cp.id != null ? 'pointer' : 'default',
                  }}
                >
                  {cp.label}{cp.zone ? ` · ${cp.zone}` : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
