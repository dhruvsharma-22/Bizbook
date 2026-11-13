-- A separate Company Admin policy for BizBook renewal and trial-expiry reminders.
-- The existing platform_reminder_policy remains the company-owned student fee schedule.

create table public.platform_subscription_reminder_policy (
  id boolean primary key default true check (id is true),
  is_enabled boolean not null default true,
  schedule jsonb not null,
  schedule_version integer not null default 1 check (schedule_version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint platform_subscription_reminder_policy_schedule_is_array check (jsonb_typeof(schedule) = 'array')
);

alter table public.platform_subscription_reminder_policy enable row level security;
create policy platform_subscription_reminder_policy_select_admin
  on public.platform_subscription_reminder_policy for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));
revoke all on public.platform_subscription_reminder_policy from public, anon, authenticated;
grant select (id, is_enabled, schedule, schedule_version, updated_at)
  on public.platform_subscription_reminder_policy to authenticated;
grant all on public.platform_subscription_reminder_policy to service_role;

insert into public.platform_subscription_reminder_policy (id, is_enabled, schedule)
values (
  true,
  true,
  '[
    {"reminder_number":1,"day_offset":-7,"channel":"Email","send_time":"09:00"},
    {"reminder_number":2,"day_offset":-3,"channel":"Email","send_time":"09:00"},
    {"reminder_number":3,"day_offset":-1,"channel":"WhatsApp","send_time":"09:00"},
    {"reminder_number":4,"day_offset":0,"channel":"WhatsApp","send_time":"09:00"},
    {"reminder_number":5,"day_offset":1,"channel":"Email","send_time":"09:00"}
  ]'::jsonb
);

create trigger platform_subscription_reminder_policy_updated_at
  before update on public.platform_subscription_reminder_policy
  for each row execute function bizbook_private.set_updated_at();

create or replace function public.save_platform_subscription_reminder_policy(
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
  v_updated public.platform_subscription_reminder_policy%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or public.get_platform_admin_role() is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_is_enabled is null or jsonb_typeof(p_schedule) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Subscription reminder policy is invalid';
  end if;

  v_count := jsonb_array_length(p_schedule);
  if v_count < 1 or v_count > 5 then
    raise exception using errcode = '22023', message = 'Configure between one and five subscription reminder stages';
  end if;

  for v_stage in select value from jsonb_array_elements(p_schedule) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_stage) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_stage)) <> 4
       or v_stage ->> 'reminder_number' is null
       or v_stage ->> 'day_offset' is null
       or v_stage ->> 'channel' is null
       or v_stage ->> 'send_time' is null then
      raise exception using errcode = '22023', message = 'Each reminder needs a stage, day, channel, and local send time';
    end if;
    if v_stage ->> 'reminder_number' !~ '^[1-5]$'
       or (v_stage ->> 'reminder_number')::integer <> v_index then
      raise exception using errcode = '22023', message = 'Subscription reminder stages must be numbered sequentially';
    end if;
    if v_stage ->> 'day_offset' !~ '^(0|-?[1-9]|-?[12][0-9]|-?30)$'
       or (v_stage ->> 'day_offset')::integer not between -30 and 30
       or v_stage ->> 'channel' not in ('Email', 'WhatsApp')
       or v_stage ->> 'send_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = '22023', message = 'Each reminder needs a valid day, channel, and local send time';
    end if;
    if (v_stage ->> 'day_offset')::integer = any(v_days) then
      raise exception using errcode = '22023', message = 'Configure one BizBook subscription reminder per date offset';
    end if;
    v_days := array_append(v_days, (v_stage ->> 'day_offset')::integer);
  end loop;

  update public.platform_subscription_reminder_policy
     set is_enabled = p_is_enabled,
         schedule = p_schedule,
         schedule_version = schedule_version + 1,
         updated_by = v_user_id
   where id is true
   returning * into v_updated;
  if not found then
    raise exception using errcode = '55000', message = 'Subscription reminder policy is not initialized';
  end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_subscription_reminder_policy_updated', 'platform_subscription_reminder_policy', 'global',
          jsonb_build_object('enabled', v_updated.is_enabled, 'stage_count', v_count, 'schedule', v_updated.schedule));

  return jsonb_build_object(
    'is_enabled', v_updated.is_enabled,
    'schedule', v_updated.schedule,
    'schedule_version', v_updated.schedule_version,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.save_platform_subscription_reminder_policy(boolean, jsonb) from public, anon, service_role;
grant execute on function public.save_platform_subscription_reminder_policy(boolean, jsonb) to authenticated;

create table public.platform_subscription_reminder_logs (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  subscription_id uuid not null,
  reminder_period_end date not null,
  reminder_number smallint not null check (reminder_number between 1 and 5),
  schedule_version integer not null check (schedule_version > 0),
  channel text not null check (channel in ('Email', 'WhatsApp')),
  delivery_status text not null check (delivery_status in ('Processing', 'Sent', 'Failed', 'Unknown', 'Skipped')),
  provider text,
  provider_message_reference text,
  recipient_fingerprint text,
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retryable boolean not null default true,
  next_attempt_at timestamptz,
  last_error_code text,
  sent_at timestamptz,
  attempted_at timestamptz not null default now(),
  foreign key (subscription_id, institute_id)
    references public.institute_subscriptions(id, institute_id) on delete restrict,
  unique (subscription_id, reminder_period_end, reminder_number)
);
create index platform_subscription_reminder_logs_history_idx
  on public.platform_subscription_reminder_logs (institute_id, attempted_at desc);
alter table public.platform_subscription_reminder_logs enable row level security;
create policy platform_subscription_reminder_logs_select_platform_admin
  on public.platform_subscription_reminder_logs for select to authenticated
  using (bizbook_private.is_platform_administrator());
revoke all on public.platform_subscription_reminder_logs from public, anon, authenticated;
grant select on public.platform_subscription_reminder_logs to authenticated;
grant all on public.platform_subscription_reminder_logs to service_role;

comment on table public.platform_reminder_policy is
  'Company Admin controls the global student installment reminder schedule; send times use each institute local time zone.';
comment on table public.platform_subscription_reminder_policy is
  'Separate Company Admin schedule for BizBook trial-expiry and subscription-renewal reminders sent to coaching institute owners.';
