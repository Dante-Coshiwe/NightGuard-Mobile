import React from 'react';

// ⚠ This is the last thing standing between a render error and a dead handset.
//
// It used to be one boundary at the root of App.jsx, wrapping everything, and its fallback was a
// raw stack trace with no way out. On a kiosk-locked phone with nobody standing at it, that is a
// total outage from a single bad render anywhere in the app:
//
//   * <PatrolRecorder /> is a SIBLING of <Routes>, so a crash while rendering a report or the
//     occurrence book unmounted the recorder too. The native service keeps recording into
//     PatrolBuffer — nothing is lost on disk — but the 15s drain that credits checkpoints and
//     feeds the offline queue is gone, so nothing is credited for the rest of the night and
//     nothing reaches the control room until somebody relaunches the app.
//   * There was no button, no reload, no navigation. The guard cannot leave the screen, and
//     kiosk lock means they often cannot leave the app either.
//
// Two things fix that, and both matter:
//
//   1. `scope="screen"` around the route outlet, so ONE screen's crash costs that screen and
//      nothing else. The shell, the recorder and the schedule alarm keep running.
//   2. A recovery path. Every piece of state that matters — shift session, patrol session, outbox,
//      Supabase session — lives in storage that survives a reload, so reloading is cheap and safe.
//      An unattended device retries by itself; a crash LOOP must not, hence the bounded counter.

const RELOAD_COUNT_KEY = 'nightguard_crash_reloads';
// Three is enough to ride out a one-off (a corrupt cache entry that the reload re-reads cleanly,
// a transient out-of-memory during a PDF build) without spinning forever on a deterministic crash.
const MAX_AUTO_RELOADS = 3;
// Long enough that a reload storm cannot flatten the battery, short enough that an unattended
// handset is back before the next patrol is due.
const AUTO_RELOAD_DELAY_MS = 8000;
// Two crashes a week apart are not a loop. Forget the count if the app has been up a while.
const RELOAD_WINDOW_MS = 10 * 60 * 1000;

function readReloadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RELOAD_COUNT_KEY) || 'null');
    if (!parsed || Date.now() - (parsed.at || 0) > RELOAD_WINDOW_MS) return { count: 0, at: 0 };
    return { count: Number(parsed.count) || 0, at: parsed.at };
  } catch {
    return { count: 0, at: 0 };
  }
}

function bumpReloadState(count) {
  try {
    localStorage.setItem(RELOAD_COUNT_KEY, JSON.stringify({ count, at: Date.now() }));
  } catch { /* a device too full to record this is exactly one that should still try to reload */ }
}

/** Called once the app has rendered successfully, so a recovered crash does not count forever. */
export function clearCrashReloadCount() {
  try { localStorage.removeItem(RELOAD_COUNT_KEY); } catch { /* best effort */ }
}

export default class ErrorBoundary extends React.Component {
  state = { error: null, errorInfo: null, showDetail: false, secondsLeft: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('=== APP CRASH ===');
    console.error(error);
    console.error(errorInfo);
    this.setState({ errorInfo });

    // Only the ROOT boundary reloads. A screen-level crash has already been contained — the rest
    // of the app is still running, and throwing away a live patrol to re-render one broken report
    // would be the cure being worse than the illness.
    if (this.props.scope === 'screen') return;

    const { count } = readReloadState();
    if (count >= MAX_AUTO_RELOADS) {
      console.error(`[ErrorBoundary] ${count} reloads in the last ${RELOAD_WINDOW_MS / 60000} min — not retrying`);
      return;
    }
    bumpReloadState(count + 1);
    this.setState({ secondsLeft: Math.round(AUTO_RELOAD_DELAY_MS / 1000) });
    this.tick = setInterval(() => {
      this.setState((s) => (s.secondsLeft > 1 ? { secondsLeft: s.secondsLeft - 1 } : s));
    }, 1000);
    this.timer = setTimeout(() => window.location.reload(), AUTO_RELOAD_DELAY_MS);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
    clearInterval(this.tick);
  }

  reset = () => {
    clearTimeout(this.timer);
    clearInterval(this.tick);
    this.setState({ error: null, errorInfo: null, showDetail: false, secondsLeft: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isScreen = this.props.scope === 'screen';
    return (
      <div style={{ padding: 20, background: '#0a0a0a', color: '#fff', minHeight: isScreen ? '60vh' : '100vh' }}>
        <h2 style={{ color: '#dc2626', marginBottom: 8 }}>
          {isScreen ? 'This screen could not open' : 'The app hit a problem'}
        </h2>
        <p style={{ color: '#d1d5db', lineHeight: 1.5, maxWidth: 520 }}>
          {isScreen
            ? 'Everything else is still running — your shift, the patrol recorder and anything waiting to upload are unaffected. Use the menu to go to another screen.'
            : 'Nothing you have captured is lost. The shift, the patrol and everything waiting to upload are saved on this device and will be there after a restart.'}
        </p>

        {/* Always a way forward, and it must not need a technical decision to use. */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '18px 0' }}>
          {isScreen ? (
            <button type="button" onClick={this.reset} style={BTN}>Try this screen again</button>
          ) : (
            <button type="button" onClick={() => window.location.reload()} style={BTN}>
              Restart the app{this.state.secondsLeft ? ` (${this.state.secondsLeft})` : ''}
            </button>
          )}
          <button
            type="button"
            onClick={() => this.setState((s) => ({ showDetail: !s.showDetail }))}
            style={{ ...BTN, background: 'transparent', border: '1px solid #374151', color: '#9ca3af' }}
          >
            {this.state.showDetail ? 'Hide details' : 'Show details'}
          </button>
        </div>

        {!isScreen && this.state.secondsLeft ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Restarting on its own — no need to wait for anyone.</p>
        ) : null}

        {/* The stack is for whoever is asked about this tomorrow, not for the guard holding the
            phone at 02:00. Behind a tap, never the first thing on screen. */}
        {this.state.showDetail && (
          <>
            <pre style={PRE}>{this.state.error.toString()}</pre>
            {this.state.errorInfo && (
              <pre style={{ ...PRE, color: '#6b7280' }}>{this.state.errorInfo.componentStack}</pre>
            )}
          </>
        )}
      </div>
    );
  }
}

const BTN = {
  padding: '12px 18px', borderRadius: 8, border: 'none', background: '#dc2626',
  color: '#fff', fontSize: 15, fontWeight: 600,
};
const PRE = {
  whiteSpace: 'pre-wrap', color: '#9ca3af', fontSize: 12, background: '#111',
  padding: 12, borderRadius: 6, overflowX: 'auto',
};
