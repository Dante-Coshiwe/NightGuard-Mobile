-- Server-backed device unbinding.
--
-- The client can clear its local Preferences, but the durable binding lives in
-- public.devices. If that row keeps site_id, the same handset re-adopts the old
-- site on the next launch. This RPC clears the server binding for admins who
-- manage the bound site, while leaving the device row and audit history intact.

create or replace function public.unbind_device(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.devices%rowtype;
  v_profile public.profiles%rowtype;
begin
  if nullif(trim(p_device_id), '') is null then
    raise exception 'DEVICE_ID_REQUIRED';
  end if;

  select * into v_device
  from public.devices
  where device_id = p_device_id
  limit 1;

  if not found then
    raise exception 'DEVICE_NOT_FOUND';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid()
  limit 1;

  if not found then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not (
    coalesce(v_profile.is_super_admin, false)
    or coalesce(v_profile.can_view_all_sites, false)
    or coalesce(v_profile.can_manage_devices, false)
    or v_profile.site_id = v_device.site_id
    or exists (
      select 1
      from public.profile_sites ps
      where ps.profile_id = v_profile.id
        and ps.site_id = v_device.site_id
    )
  ) then
    raise exception 'SITE_NOT_PERMITTED';
  end if;

  update public.devices
  set site_id = null,
      site_bound_at = null,
      site_bound_by = null,
      updated_at = now()
  where id = v_device.id;
end;
$$;

grant execute on function public.unbind_device(text) to authenticated;