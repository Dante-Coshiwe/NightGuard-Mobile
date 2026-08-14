-- Attribute activity to the DEVICE, not to a guard.
--
-- NightGuard is a shared-handset product: the device is passed from one guard to the next with no
-- login, no PIN and no shift handover. Guards are not provisioned (public.guards has always been
-- empty), so guard_id/local_guard_id have never identified anyone, and shift_id was null on every
-- row anyway — the app minted a local `shift_<ts>` id that the server dropped as a non-UUID, so
-- the link was never written. The device id is the only thing that has ever been real: it is
-- hardware-bound (`NG-<ANDROID_ID>`) and survives reinstall.
--
-- `shifts` already carries device_id. These six tables carry only shift_id/guard_id/local_guard_id,
-- so there was nowhere to record which handset logged an entry. This adds it.
--
-- Nullable and additive on purpose: existing rows keep NULL (the information is genuinely
-- unavailable for them and must not be guessed), and a handset that cannot resolve its device row
-- must still be able to work a shift.

alter table public.pedestrians add column if not exists device_id uuid;
alter table public.vehicles    add column if not exists device_id uuid;
alter table public.patrols     add column if not exists device_id uuid;
alter table public.nfc_scans   add column if not exists device_id uuid;
alter table public.incidents   add column if not exists device_id uuid;
alter table public.ob_entries  add column if not exists device_id uuid;

do $$
declare t text;
begin
  foreach t in array array['pedestrians','vehicles','patrols','nfc_scans','incidents','ob_entries']
  loop
    -- FK to devices(id), matching how shifts.device_id is already wired.
    if not exists (
      select 1 from pg_constraint where conname = t || '_device_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (device_id) references public.devices(id)',
        t, t || '_device_id_fkey'
      );
    end if;

    -- "What did this handset do, most recent first" is the query the dashboard will run.
    execute format(
      'create index if not exists %I on public.%I (device_id, created_at desc)',
      'idx_' || t || '_device_id_created_at', t
    );
  end loop;
end $$;
