import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Every request gets a hard deadline.
//
// A guard post is rarely cleanly offline — it is connected to a wifi access
// point with no route out, or on a 2-bar mobile signal. In that state the
// device reports itself online, so the app happily issues queries that then sit
// on the platform's default socket timeout (minutes). Anything awaiting one
// hangs with it, which is what made screens sit on a spinner instead of falling
// back to their cache.
//
// 12s is far longer than a healthy query and far shorter than a guard's
// patience. On expiry the fetch aborts, supabase-js surfaces it as an error,
// and the caller falls back to cached data like any other failure.
const REQUEST_TIMEOUT_MS = 12000;

const timeoutFetch = (input, init = {}) => {
  // Respect a caller's own signal if it passed one; otherwise mint ours.
  if (init.signal) return fetch(input, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timeoutFetch },
});
