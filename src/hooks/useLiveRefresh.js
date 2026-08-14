import { useEffect, useRef } from 'react';
import { NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT } from '../lib/connectivity';

// ============================================================================
//  A refresh is not a page load.
//
//  Every list screen has to re-read the server when the offline queue drains or
//  the handset finds signal again. The screens that did that by calling their
//  own loader — the one that starts with `setLoading(true)` — swapped the whole
//  list for "Loading…" every single time, which on this theme reads as the page
//  going black and then coming back. That is the flicker reported on the OB and
//  Incident screens; the report screens never re-raised `loading` after the
//  first paint, which is exactly why they looked fine.
//
//  It fires far more often than it looks. NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT
//  is dispatched with forceRecheck on every `visibilitychange`, `focus`,
//  `pageshow` and native network change (see refreshConnectivityState in
//  lib/connectivity.js), and again from confirmAppOnline() after *each*
//  successfully synced queue item — debounced to one every 1.5 s, so a drain of
//  a dozen entries strobes the list for as long as it lasts. On top of that the
//  queue's own 60 s auto-retry keeps that cycle going while anything is pending.
//
//  So: one coalesced, non-blanking refresh per screen. Callers pass a handler
//  that refreshes *silently* — it must not touch a `loading` flag and must not
//  blank the list if the read fails, because what is already on screen is still
//  true.
// ============================================================================

// The three signals that mean "the server may hold something newer than this".
const REFRESH_EVENTS = [
  'nightguard_sync_complete',
  'online',
  NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT,
];

// Trailing edge: collapse a burst of events into a single read.
const COALESCE_MS = 600;
// Floor between two completed reads, so a busy queue cannot turn this into a
// fetch loop on a gate tablet's data. Nothing is dropped — a refresh asked for
// inside the floor is simply deferred until it elapses.
const MIN_INTERVAL_MS = 5000;

/**
 * Re-run `refresh` whenever the app syncs or regains connectivity, coalesced.
 * `refresh` is re-read on every render, so it may close over current state.
 */
export function useLiveRefresh(refresh) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let running = false;
    let queued = false;
    let lastRunAt = 0;

    const run = async () => {
      // Never two at once: the second would race the first and could land the
      // older answer last.
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        await refreshRef.current();
      } catch (err) {
        // A background refresh that fails is not the guard's problem — the
        // screen keeps showing what it already had.
        console.warn('[LiveRefresh] Background refresh failed:', err?.message || err);
      } finally {
        running = false;
        lastRunAt = Date.now();
        if (queued && !cancelled) {
          queued = false;
          schedule();
        }
      }
    };

    function schedule() {
      if (cancelled) return;
      const sinceLast = Date.now() - lastRunAt;
      const delay = Math.max(COALESCE_MS, MIN_INTERVAL_MS - sinceLast);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delay);
    }

    REFRESH_EVENTS.forEach((name) => window.addEventListener(name, schedule));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      REFRESH_EVENTS.forEach((name) => window.removeEventListener(name, schedule));
    };
  }, []);
}

export default useLiveRefresh;
