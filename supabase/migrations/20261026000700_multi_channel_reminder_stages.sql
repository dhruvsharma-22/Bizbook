-- A single scheduled reminder stage may deliver over Email, WhatsApp, or both.
-- Keep delivery attempts and idempotency independent for each channel.

drop index if exists public.notification_logs_reminder_stage_unique;
create unique index notification_logs_reminder_stage_unique
  on public.notification_logs (
    institute_id,
    reminder_installment_id,
    reminder_number,
    reminder_schedule_version,
    channel
  )
  where reminder_installment_id is not null;

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.platform_subscription_reminder_logs'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (subscription_id, reminder_period_end, reminder_number)';

  if v_constraint_name is not null then
    execute format(
      'alter table public.platform_subscription_reminder_logs drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$$;

alter table public.platform_subscription_reminder_logs
  add constraint platform_subscription_reminder_logs_stage_channel_unique
  unique (subscription_id, reminder_period_end, reminder_number, channel);

comment on index public.notification_logs_reminder_stage_unique is
  'Idempotency for each student fee reminder stage and delivery channel.';
