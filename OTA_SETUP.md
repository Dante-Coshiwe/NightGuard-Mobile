# Self-Hosted OTA Update Service (Supabase)

This app ships web updates ("live updates") over-the-air from **your own Supabase
project** instead of the Capgo cloud. You push a new web build; devices download
and apply it on their next launch/resume — no Play Store release needed for
JS/HTML/CSS changes.

> Native changes (new Capacitor plugins, `AndroidManifest`, native code, app
> icon) still require a real APK release. OTA only swaps the web bundle in `dist/`.

---

## Architecture

```
 Android app (Capacitor, manual updater mode)
      │  1. POST { deviceId, orgId, currentVersion, nativeVersion }
      ▼
 Edge Function: ota-check ──► RPC ota_resolve_bundle() ──► ota_bundles / channels / org assignments
      │  returns { updateAvailable, version, signedUrl, mandatory, ... }
      ▼
 Supabase Storage (private bucket: ota-bundles)  ── device downloads bundle.zip via signed URL
      │  2. plugin.download() → plugin.next()  (applies on next background/restart)
      ▼
 Edge Function: ota-report ──► ota_update_logs (audit)  + updates devices.app_version
```

**Why manual mode?** The Capgo plugin's built-in `autoUpdate` is hardwired to
Capgo's backend/protocol. We set `autoUpdate: false` and drive the plugin's
`download → next/set` methods ourselves, pointing at Supabase. This is the
supported self-hosted path.

**Rollout model:** per-organization channels. Each org follows a channel
(`production` / `beta`) and can be pinned to an exact version or opted out.
Unassigned orgs default to `production`.

**Security:** bundles live in a **private** bucket. Devices never read the
catalog or storage directly (RLS is on with no anon policies). Only the Edge
Functions (service role) can resolve a bundle and mint a **5-minute signed URL**.

---

## Files added

| File | Purpose |
|------|---------|
| `supabase/migrations/20260714_ota_service.sql` | Tables, resolver RPC, RLS, private bucket |
| `supabase/functions/ota-check/index.ts` | "Is there an update for me?" → signed URL |
| `supabase/functions/ota-report/index.ts` | Device reports download/apply/failure |
| `scripts/ota-publish.mjs` | Zip `dist/`, upload, record bundle (run via npm) |
| `src/services/liveUpdate.js` | Client: check → download → stage → report |
| `src/main.jsx` | Triggers the check on launch + on resume |
| `capacitor.config.json` | `CapacitorUpdater.autoUpdate` → `false` (manual mode) |

---

## One-time setup

### 1. Run the database migration
In the Supabase dashboard → **SQL Editor**, paste and run
`supabase/migrations/20260714_ota_service.sql`.
(Or, with the CLI linked: `supabase db push`.)

This creates the tables, the `production` + `beta` channels, the resolver
function, and the private `ota-bundles` bucket.

### 2. Deploy the Edge Functions
Install the CLI once (`npm i -g supabase`), then:

```bash
supabase login
supabase link --project-ref udpzngmsieixfpvbgidw

supabase functions deploy ota-check  --no-verify-jwt
supabase functions deploy ota-report --no-verify-jwt
```

> `--no-verify-jwt` is required: the app calls these with the **anon** key, not a
> logged-in user JWT. Authorization is enforced by the functions themselves
> (they only ever return release metadata + a short-lived signed URL).

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into deployed
functions automatically — you do **not** set those secrets manually.

### 3. Add the service-role key locally (for publishing only)
The publish script needs the **service_role** key. Get it from
**Project Settings → API → `service_role` secret** and add to `.env`:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-secret...
```

⚠️ **Never** commit this key or put it in any `VITE_` variable — `VITE_` values
are bundled into the app. It stays on your machine / CI only. (`.env` is already
git-ignored for secrets; confirm it is.)

### 4. Rebuild and reinstall the native app once
Because `capacitor.config.json` changed (manual mode), do one native release so
devices run the manual-mode shell:

```bash
npm run build
npx cap sync android
# then build/sign the APK as usual and distribute it
```

From then on, web changes go out via OTA — no more store releases for those.

---

## Publishing an update (the routine you'll repeat)

1. Bump the version in **`src/services/liveUpdate.js`**:
   ```js
   export const OTA_CURRENT_VERSION = '1.1.0';   // was 1.0.0
   ```
   This is the single source of truth for the running version.

2. Publish:
   ```bash
   npm run ota:publish                      # → production
   # or
   npm run ota:publish:beta                 # → beta channel
   ```
   The script builds `dist/`, zips it, uploads to
   `ota-bundles/<channel>/<version>/bundle.zip`, and inserts the `ota_bundles`
   row.

3. Devices pick it up on their next launch or resume, download in the
   background, and apply on the following background/restart.

**Optional flags:**
```bash
node scripts/ota-publish.mjs --channel production --version 1.1.0 \
  --notes "Fixes patrol timer" \
  --mandatory \                 # client applies immediately + reloads
  --min-native 1.0.0            # don't serve to APKs older than 1.0.0
```

---

## Managing rollout (SQL snippets)

**Put an organization on the beta channel:**
```sql
insert into org_ota_assignments (organization_id, channel_id)
values ('<org-uuid>', (select id from ota_channels where name = 'beta'))
on conflict (organization_id)
do update set channel_id = excluded.channel_id, pinned_version = null, updated_at = now();
```

**Pin an org to an exact version (freeze them):**
```sql
update org_ota_assignments
set pinned_version = '1.0.0', updated_at = now()
where organization_id = '<org-uuid>';
```

**Disable OTA for an org (they stay on whatever they have):**
```sql
update org_ota_assignments set auto_update = false where organization_id = '<org-uuid>';
```

**Withdraw a bad bundle (stop serving it; devices already on it keep it until the next good one):**
```sql
update ota_bundles set is_active = false where version = '1.1.0';
```

**See update history for a device:**
```sql
select created_at, status, from_version, to_version, error_message
from ota_update_logs
where device_id = 'NG-ABC123-XYZ'
order by created_at desc
limit 50;
```

---

## How rollback works
The plugin stages the new bundle and boots it. `notifyLiveUpdateReady()` runs at
the very start of `src/main.jsx`. If the new bundle crashes before that call (or
within `appReadyTimeout`, 20s), the plugin automatically reverts to the previous
working bundle. So a broken JS release self-heals on the device.

To force everyone back, publish a **new, higher** version containing the fix —
that's the forward-fix path and the one to prefer.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Device never updates | Is it a **native** build with `autoUpdate:false`? Web builds are no-ops. Is the org assigned/pinned to a version it already has? |
| `signing_failed` in logs | Bundle row's `storage_path` must exist in the `ota-bundles` bucket. Re-run `ota:publish`. |
| `resolver_failed` | Migration not run, or no `production` channel. Re-run the SQL. |
| Update downloads but reverts | New bundle throws on boot before `notifyLiveUpdateReady()`. Check device logs; forward-fix with a new version. |
| Publish fails: service role | `SUPABASE_SERVICE_ROLE_KEY` missing/incorrect in `.env`. |
