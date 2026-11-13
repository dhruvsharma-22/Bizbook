-- Include the institute-wide active usage and assigned limit in plan-cap errors.
-- This only changes the error detail returned when a future student/staff write is rejected.
create or replace function bizbook_private.enforce_student_plan_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer;
  v_count bigint;
begin
  if new.archived_at is not null or (tg_op = 'UPDATE' and old.archived_at is null) then
    return new;
  end if;

  select p.student_limit into v_limit
  from public.institute_subscriptions s
  join public.platform_subscription_plans p on p.id = s.plan_id
  where s.institute_id = new.institute_id
  for update of s;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.students
  where institute_id = new.institute_id
    and archived_at is null
    and id <> new.id;

  if v_count >= v_limit then
    raise exception using
      errcode = '23514',
      message = pg_catalog.format('PLAN_LIMIT_REACHED|students|%s|%s', v_count, v_limit);
  end if;

  return new;
end;
$$;

create or replace function bizbook_private.enforce_staff_plan_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer;
  v_count bigint;
begin
  if new.archived_at is not null or (tg_op = 'UPDATE' and old.archived_at is null) then
    return new;
  end if;

  select p.staff_limit into v_limit
  from public.institute_subscriptions s
  join public.platform_subscription_plans p on p.id = s.plan_id
  where s.institute_id = new.institute_id
  for update of s;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.staff
  where institute_id = new.institute_id
    and archived_at is null
    and id <> new.id;

  if v_count >= v_limit then
    raise exception using
      errcode = '23514',
      message = pg_catalog.format('PLAN_LIMIT_REACHED|staff|%s|%s', v_count, v_limit);
  end if;

  return new;
end;
$$;
