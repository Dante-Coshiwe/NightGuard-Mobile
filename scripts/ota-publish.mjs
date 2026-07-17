// ============================================================================
//  OTA publish script — uploads a freshly built web bundle to the self-hosted
//  Supabase OTA service.
//
//  What it does:
//    1. Zips the CONTENTS of dist/ (so index.html sits at the zip root) into a
//       temp file, using the platform's built-in zip tool (no npm deps).
//    2. Computes the zip's sha256.
//    3. Uploads it to the private `ota-bundles` storage bucket at
//       <channel>/<version>/bundle.zip.
//    4. Inserts (or upserts) the matching row in public.ota_bundles.
//
//  Usage:
//    npm run ota:publish                 # publishes to 'production'
//    npm run ota:publish:beta            # publishes to 'beta'
//    node scripts/ota-publish.mjs --channel production --version 1.4.0 --notes "Fix X"
//    node scripts/ota-publish.mjs --mandatory --min-native 1.0.0
//
//  Version: taken from --version, else OTA_CURRENT_VERSION in
//  src/services/liveUpdate.js (kept as the single source of truth).
//
//  Requires these env vars (put them in .env — they are NOT shipped in the app):
//    SUPABASE_URL                 (same as VITE_SUPABASE_URL)
//    SUPABASE_SERVICE_ROLE_KEY    (Project Settings -> API -> service_role secret)
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST_DIR = join(ROOT, 'dist');
const BUCKET = 'ota-bundles';

// --- tiny .env loader (so we don't need dotenv) ----------------------------
function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

// --- args ------------------------------------------------------------------
function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true; // bare flag => true
}

function readCurrentVersion() {
  try {
    const src = readFileSync(join(ROOT, 'src', 'services', 'liveUpdate.js'), 'utf8');
    const m = src.match(/OTA_CURRENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const channel = arg('channel', 'production');
const version = arg('version', readCurrentVersion());
const notes = arg('notes', '');
const minNative = arg('min-native', null);
const mandatory = arg('mandatory', false) === true;

// --- validation ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg) {
  console.error(`\n[ota-publish] ERROR: ${msg}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail('SUPABASE_URL (or VITE_SUPABASE_URL) is not set.');
if (!SERVICE_KEY) {
  fail('SUPABASE_SERVICE_ROLE_KEY is not set. Get it from Supabase → Project Settings → API → service_role, and add it to .env (never commit it, never ship it in the app).');
}
if (!version || version === true) fail('No version. Pass --version 1.4.0 or set OTA_CURRENT_VERSION in src/services/liveUpdate.js.');
if (!/^\d+\.\d+\.\d+/.test(version)) fail(`Version "${version}" is not semver (expected x.y.z).`);
if (!existsSync(join(DIST_DIR, 'index.html'))) {
  fail('dist/index.html not found. Run "npm run build" first (npm run ota:publish does this for you).');
}

// --- zip dist/ contents (index.html at zip root) ---------------------------
function zipDist(outFile) {
  if (process.platform === 'win32') {
    // NEVER Compress-Archive here: it writes zip entries with BACKSLASH path
    // separators, and the Capgo Android unzipper rejects those ("Windows path
    // not supported"), so every download fails on-device. Use JDK jar (present
    // for the Android build) or Windows' bsdtar — both write forward slashes.
    const jarCandidates = [
      'jar',
      process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', 'jar.exe'),
      'C:\\Program Files\\Java\\jdk-17\\bin\\jar.exe',
      'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\jar.exe',
    ].filter(Boolean);
    for (const jar of jarCandidates) {
      try {
        execFileSync(jar, ['-c', '-f', outFile, '-M', '-C', DIST_DIR, '.'], { stdio: 'inherit' });
        return;
      } catch { /* try next candidate */ }
    }
    // bsdtar fallback (ships with Windows 10+). Must use a RELATIVE -f path:
    // bsdtar parses "C:\..." as a remote host ("Cannot connect to C").
    execFileSync('tar', ['-a', '-c', '-f', relative(DIST_DIR, outFile), '.'], {
      cwd: DIST_DIR,
      stdio: 'inherit',
    });
  } else {
    // zip -r from inside dist so paths are relative to the bundle root.
    execFileSync('zip', ['-r', '-q', outFile, '.'], { cwd: DIST_DIR, stdio: 'inherit' });
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'ota-'));
const zipPath = join(tmp, 'bundle.zip');

console.log(`[ota-publish] Channel:  ${channel}`);
console.log(`[ota-publish] Version:  ${version}`);
console.log(`[ota-publish] Zipping dist/ …`);
zipDist(zipPath);

const zipBuf = readFileSync(zipPath);
const checksum = createHash('sha256').update(zipBuf).digest('hex');
const sizeBytes = zipBuf.length;
const storagePath = `${channel}/${version}/bundle.zip`;

console.log(`[ota-publish] Size:     ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`[ota-publish] SHA-256:  ${checksum}`);
console.log(`[ota-publish] Path:     ${storagePath}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // 1. Resolve channel id.
  const { data: chan, error: chanErr } = await supabase
    .from('ota_channels')
    .select('id')
    .eq('name', channel)
    .single();
  if (chanErr || !chan) {
    fail(`Channel "${channel}" not found. Run the OTA migration first, or create the channel.`);
  }

  // 2. Upload the zip (overwrite if re-publishing the same version).
  console.log('[ota-publish] Uploading zip to Storage …');
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, zipBuf, {
      contentType: 'application/zip',
      upsert: true,
    });
  if (upErr) fail(`Storage upload failed: ${upErr.message}`);

  // 3. Upsert the bundle row (unique on channel_id + version).
  console.log('[ota-publish] Recording bundle in database …');
  const { error: rowErr } = await supabase
    .from('ota_bundles')
    .upsert(
      {
        channel_id: chan.id,
        version,
        storage_path: storagePath,
        checksum,
        size_bytes: sizeBytes,
        release_notes: notes || null,
        min_native_version: minNative || null,
        is_mandatory: mandatory,
        is_active: true,
      },
      { onConflict: 'channel_id,version' },
    );
  if (rowErr) fail(`Database insert failed: ${rowErr.message}`);

  console.log(`\n✅ Published ${version} to "${channel}". Devices on that channel will pick it up on their next check.\n`);
}

main()
  .catch((err) => fail(err?.message || String(err)))
  .finally(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });
