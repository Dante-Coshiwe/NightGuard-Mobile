# Rolling out device→site binding (web bundle 1.1.0)

No APK. Nothing here touches `android/` — no new plugin, no manifest change, no
permission, no `versionCode`. It ships over the air like any other `src/` change.

## Run these in order

The migration must land **before** the bundle. Ship the bundle first and the app
falls back to the old admin binding (harmless, but the picker and the server-side
device record do nothing until the RPCs exist).

### 1. Apply the migration

`NightGuardTrackApp/supabase/migrations/20260731000000_multi_site_binding.sql`

Paste it into the Supabase SQL editor, or:

```bash
supabase db push
```

It creates `profile_sites`, `my_sites()`, `claim_device()`, `device_site()` and the
`device_site_audit` view, and backfills every existing `profiles.site_id` into
`profile_sites`. It is safe to run more than once.

### 2. Give the multi-site managers their sites

The backfill only carries over the one site each manager already had. Add the rest.

`profile_sites` has RLS on with no policies, so it is deliberately not reachable
from the dashboard or the app — it decides who sees what, and a public table with
RLS off would let any signed-in user grant themselves a site. Run this from the
Supabase SQL editor, which runs as `postgres` and bypasses RLS:

```sql
insert into public.profile_sites (profile_id, site_id)
select p.id, s.id
  from public.profiles p, public.sites s
 where p.email = 'manager@example.com'
   and s.site_name in ('Site A', 'Site B', 'Site C')
on conflict do nothing;
```

### 2b. Optional: tighten the grants

Supabase's `ALTER DEFAULT PRIVILEGES` grants new public tables and functions to
`anon`/`authenticated` directly, which a `REVOKE ... FROM PUBLIC` does not undo.
RLS already denies every read and write on `profile_sites`, and `my_sites()`
returns nothing without a JWT, so this is defense in depth rather than a fix:

```sql
revoke all     on public.profile_sites from anon, authenticated;
revoke execute on function public.my_sites() from anon;

-- confirm: expects profile_sites rowsecurity = true, and no anon grants
select relname, relrowsecurity from pg_class where relname = 'profile_sites';
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'profile_sites';
```

Then confirm the backfill actually carried everyone over:

```sql
select count(*) as backfilled from public.profile_sites;
select count(*) as expected  from public.profiles where site_id is not null;
```

### 3. Publish the bundle as mandatory

```bash
npm run ota:publish -- --mandatory --notes "Device-level site binding"
```

Needs `SUPABASE_SERVICE_ROLE_KEY` in `.env` (Supabase → Project Settings → API →
service_role). It is read by the publish script only and never enters the bundle.

Version comes from `OTA_CURRENT_VERSION` in `src/services/liveUpdate.js` — now
`1.1.0`.

### 4. Confirm devices landed on the right sites

```sql
select * from public.device_site_audit order by site_name, device_id;
```

Every device in the field should already show its correct site, adopted from the
binding it was running on. Anything with a null `site_id` never had one and will
ask its manager to pick on the next admin login.

```sql
-- rollout progress
select to_version, status, count(*)
  from public.ota_update_logs
 where created_at > now() - interval '24 hours'
 group by 1, 2 order by 1, 2;
```

## What devices in the field experience

Nothing. Specifically:

- **No sign-out.** The bundle swap keeps the same webview origin, and on Android
  `localStorage` is additionally backed by a file in `Directory.Data`
  (`src/lib/nativeStorage.js`), so the Supabase session, the cached user, the shift
  session and the offline queue all survive. Nothing in this change clears a
  storage key, and `clearAdminDeviceBinding()` is not called anywhere new.
- **No picker.** `resolveSiteBinding()` adopts the site the device is already
  running on and registers it server-side. The picker only appears for a device
  that has no site anywhere — a new one, or one whose storage was wiped.
- **No interruption mid-shift.** Mandatory normally applies immediately, which
  reloads the JS context. `runOtaUpdate` now stages instead while a shift is
  active, so it applies at the next background or restart — the shift change on a
  kiosk. It is still mandatory; it just waits for a safe moment.

## Rollback

From the Supabase dashboard:

```sql
update public.ota_bundles set is_active = false where version = '1.1.0';
```

Devices fall back to the previous active bundle on their next check. The migration
can stay — the old bundle ignores the new tables and functions.
