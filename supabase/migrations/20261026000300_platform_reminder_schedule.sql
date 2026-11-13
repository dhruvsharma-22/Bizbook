-- Owner-configurable installment reminders. Times are interpreted in each institute's local time zone.

create table public.platform_reminder_policy (
  id boolean primary key default true check (id is true),
  is_enabled boolean not null default true,
  schedule jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint platform_reminder_policy_schedule_is_array check (jsonb_typeof(schedule) = 'array')
);

alter table public.platform_reminder_policy enable row level security;
create policy platform_reminder_policy_select_admin
  on public.platform_reminder_policy for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));
revoke all on public.platform_reminder_policy from public, anon, authenticated;
grant select (id, is_enabled, schedule, updated_at) on public.platform_reminder_policy to authenticated;
grant all on public.platform_reminder_policy to service_role;

insert into public.platform_reminder_policy (id, is_enabled, schedule)
values (
  true,
  true,
  '[
    {"reminder_number":1,"day_offset":-3,"channel":"Email","send_time":"09:00"},
    {"reminder_number":2,"day_offset":-2,"channel":"Email","send_time":"09:00"},
    {"reminder_number":3,"day_offset":-1,"channel":"WhatsApp","send_time":"09:00"},
    {"reminder_number":4,"day_offset":0,"channel":"WhatsApp","send_time":"09:00"},
    {"reminder_number":5,"day_offset":1,"channel":"WhatsApp","send_time":"09:00"}
  ]'::jsonb
);

create trigger platform_reminder_policy_updated_at
  before update on public.platform_reminder_policy
  for each row execute function bizbook_private.set_updated_at();

create or replace function public.save_platform_reminder_policy(
  p_is_enabled boolean,
  p_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_stage jsonb;
  v_index integer := 0;
  v_count integer;
  v_days integer[] := array[]::integer[];
  v_updated public.platform_reminder_policy%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or public.get_platform_admin_role() is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_is_enabled is null or jsonb_typeof(p_schedule) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Reminder policy is invalid';
  end if;

  v_count := jsonb_array_length(p_schedule);
  if v_count < 1 or v_count > 5 then
    raise exception using errcode = '22023', message = 'Configure between one and five reminder stages';
  end if;

  for v_stage in select value from jsonb_array_elements(p_schedule) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_stage) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Each reminder stage must be an object';
    end if;
    if (select count(*) from jsonb_object_keys(v_stage)) <> 4
       or v_stage ->> 'reminder_number' is null
       or v_stage ->> 'day_offset' is null
       or v_stage ->> 'channel' is null
       or v_stage ->> 'send_time' is null then
      raise exception using errcode = '22023', message = 'Each reminder needs a valid stage, day, channel, and local send time';
    end if;
    if v_stage ->> 'reminder_number' !~ '^[1-5]$' then
      raise exception using errcode = '22023', message = 'Reminder stages must be numbered sequentially from one';
    end if;
    if (v_stage ->> 'reminder_number')::integer <> v_index then
      raise exception using errcode = '22023', message = 'Reminder stages must be numbered sequentially from one';
    end if;
    if v_stage ->> 'day_offset' !~ '^(0|-?[1-9]|-?[12][0-9]|-?30)$' then
      raise exception using errcode = '22023', message = 'Reminder day offsets must be between -30 and 30';
    end if;
    if (v_stage ->> 'day_offset')::integer not between -30 and 30
       or v_stage ->> 'channel' not in ('Email', 'WhatsApp')
       or v_stage ->> 'send_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = '22023', message = 'Each reminder needs a valid stage, day, channel, and local send time';
    end if;
    if (v_stage ->> 'day_offset')::integer = any(v_days) then
      raise exception using errcode = '22023', message = 'Configure one student reminder per due-date offset';
    end if;
    v_days := array_append(v_days, (v_stage ->> 'day_offset')::integer);
  end loop;

  update public.platform_reminder_policy
     set is_enabled = p_is_enabled,
         schedule = p_schedule,
         updated_by = v_user_id
   where id is true
   returning * into v_updated;
  if not found then
    raise exception using errcode = '55000', message = 'Reminder policy is not initialized';
  end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_reminder_policy_updated', 'platform_reminder_policy', 'global',
          jsonb_build_object('enabled', v_updated.is_enabled, 'stage_count', v_count, 'schedule', v_updated.schedule));

  return jsonb_build_object(
    'is_enabled', v_updated.is_enabled,
    'schedule', v_updated.schedule,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.save_platform_reminder_policy(boolean, jsonb) from public, anon, service_role;
grant execute on function public.save_platform_reminder_policy(boolean, jsonb) to authenticated;

comment on table public.platform_reminder_policy is
  'Global platform-owner-configured installment reminder stages. Send times are local to each institute.';
