-- Allow same-date stages and Both-channel delivery in both company-controlled reminder policies.
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
  v_updated public.platform_reminder_policy%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or coalesce(public.get_platform_admin_role(), '') not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = 'Company administrator access is required';
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
    if jsonb_typeof(v_stage) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_stage)) <> 4
       or v_stage ->> 'reminder_number' is null
       or v_stage ->> 'day_offset' is null
       or v_stage ->> 'channel' is null
       or v_stage ->> 'send_time' is null then
      raise exception using errcode = '22023', message = 'Each reminder needs a valid stage, day, channel, and local send time';
    end if;
    if v_stage ->> 'reminder_number' !~ '^[1-5]$'
       or (v_stage ->> 'reminder_number')::integer <> v_index then
      raise exception using errcode = '22023', message = 'Reminder stages must be numbered sequentially from one';
    end if;
    if v_stage ->> 'day_offset' !~ '^(0|-?[1-9]|-?[12][0-9]|-?30)$'
       or (v_stage ->> 'day_offset')::integer not between -30 and 30
       or v_stage ->> 'channel' not in ('Email', 'WhatsApp', 'Both')
       or v_stage ->> 'send_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = '22023', message = 'Each reminder needs a valid stage, day, channel, and local send time';
    end if;
  end loop;

  update public.platform_reminder_policy
     set is_enabled = p_is_enabled,
         schedule = p_schedule,
         updated_by = v_user_id
   where id is true
   returning * into v_updated;
  if not found then raise exception using errcode = '55000', message = 'Reminder policy is not initialized'; end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_reminder_policy_updated', 'platform_reminder_policy', 'global',
          jsonb_build_object('enabled', v_updated.is_enabled, 'stage_count', v_count, 'schedule', v_updated.schedule));
  return jsonb_build_object('is_enabled', v_updated.is_enabled, 'schedule', v_updated.schedule, 'updated_at', v_updated.updated_at);
end;
$$;

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
  v_updated public.platform_subscription_reminder_policy%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or coalesce(public.get_platform_admin_role(), '') not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = 'Company administrator access is required';
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
       or v_stage ->> 'channel' not in ('Email', 'WhatsApp', 'Both')
       or v_stage ->> 'send_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = '22023', message = 'Each reminder needs a valid day, channel, and local send time';
    end if;
  end loop;

  update public.platform_subscription_reminder_policy
     set is_enabled = p_is_enabled,
         schedule = p_schedule,
         schedule_version = schedule_version + 1,
         updated_by = v_user_id
   where id is true
   returning * into v_updated;
  if not found then raise exception using errcode = '55000', message = 'Subscription reminder policy is not initialized'; end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_subscription_reminder_policy_updated', 'platform_subscription_reminder_policy', 'global',
          jsonb_build_object('enabled', v_updated.is_enabled, 'stage_count', v_count, 'schedule', v_updated.schedule));
  return jsonb_build_object('is_enabled', v_updated.is_enabled, 'schedule', v_updated.schedule,
                            'schedule_version', v_updated.schedule_version, 'updated_at', v_updated.updated_at);
end;
$$;

revoke all on function public.save_platform_reminder_policy(boolean, jsonb) from public, anon, service_role;
revoke all on function public.save_platform_subscription_reminder_policy(boolean, jsonb) from public, anon, service_role;
grant execute on function public.save_platform_reminder_policy(boolean, jsonb) to authenticated;
grant execute on function public.save_platform_subscription_reminder_policy(boolean, jsonb) to authenticated;
