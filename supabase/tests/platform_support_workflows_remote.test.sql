begin;
create temporary table test_results (assertion_no bigint generated always as identity primary key, passed boolean not null, description text not null);
create temporary table test_plan (expected integer not null);
create temporary table fixtures (
  platform_id uuid, requester_id uuid, outsider_id uuid, institute_id text, other_institute_id text,
  ticket_id uuid, message_id uuid, request_key uuid, reply_key uuid
);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin insert into pg_temp.test_results(passed, description) values(coalesce(passed, false), description); return coalesce(passed, false); end; $$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$ begin insert into pg_temp.test_plan values(expected); return '1..' || expected::text; end; $$;
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$ begin return pg_temp.record_test(passed, description); end; $$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare expected_count integer; actual_count bigint; failure_count bigint; item record;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed) into actual_count, failure_count from pg_temp.test_results;
  return next '1..' || coalesce(expected_count, 0)::text;
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no::text || ' - ' || item.description;
  end loop;
  return next format('# assertions=%s failed=%s planned=%s', actual_count, failure_count, expected_count);
end;
$$;
do $$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$$;
select pg_temp.plan(29);

insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'platform-support-admin-' || gen_random_uuid()::text || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'platform-support-requester-' || gen_random_uuid()::text || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'platform-support-outsider-' || gen_random_uuid()::text || '@example.invalid');
insert into pg_temp.fixtures(platform_id, requester_id, outsider_id, institute_id, other_institute_id, request_key, reply_key)
select
  (select id from auth.users where email like 'platform-support-admin-%@example.invalid' order by created_at desc limit 1),
  (select id from auth.users where email like 'platform-support-requester-%@example.invalid' order by created_at desc limit 1),
  (select id from auth.users where email like 'platform-support-outsider-%@example.invalid' order by created_at desc limit 1),
  'support-test-' || replace(gen_random_uuid()::text, '-', ''),
  'support-outsider-' || replace(gen_random_uuid()::text, '-', ''),
  gen_random_uuid(), gen_random_uuid();

select pg_temp.ok(not has_function_privilege('anon', 'public.create_platform_support_ticket(text,text,text,text,uuid)', 'EXECUTE'), 'anon cannot create support tickets');
select pg_temp.ok(not has_function_privilege('anon', 'public.list_my_platform_support_tickets(text,integer,integer)', 'EXECUTE'), 'anon cannot list institute support tickets');
select pg_temp.ok(not has_function_privilege('anon', 'public.list_platform_support_tickets(text,integer,integer)', 'EXECUTE'), 'anon cannot read the global support queue');
select pg_temp.ok(has_function_privilege('authenticated', 'public.create_platform_support_ticket(text,text,text,text,uuid)', 'EXECUTE'), 'authenticated clients can invoke the membership-checked create RPC');
select pg_temp.ok(has_function_privilege('authenticated', 'public.list_platform_support_tickets(text,integer,integer)', 'EXECUTE'), 'authenticated clients can invoke the platform-role-checked queue RPC');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.platform_support_tickets'::regclass), 'ticket table has RLS enabled');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.platform_support_messages'::regclass), 'message table has RLS enabled');

insert into public.coaching_institutes(id, business_name)
select institute_id, 'Synthetic Support Institute' from pg_temp.fixtures
union all select other_institute_id, 'Synthetic Support Other Institute' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, requester_id, 'staff', 'institute' from pg_temp.fixtures
union all select other_institute_id, outsider_id, 'owner', 'institute' from pg_temp.fixtures;
insert into public.platform_administrators(user_id, role)
select platform_id, 'support' from pg_temp.fixtures;

select set_config('request.jwt.claim.sub', (select requester_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select requester_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
update pg_temp.fixtures f set ticket_id = public.create_platform_support_ticket(
  f.institute_id, 'payments', 'Sandbox receipt question',
  'The sandbox receipt reference does not appear in my payment history.', f.request_key
);
select pg_temp.ok(exists(select 1 from public.platform_support_tickets where id = (select ticket_id from pg_temp.fixtures) and status = 'open'), 'active institute member creates an open support request');
select pg_temp.ok(exists(select 1 from public.platform_support_messages where ticket_id = (select ticket_id from pg_temp.fixtures) and author_kind = 'institute'), 'ticket and initial message are saved atomically');
select pg_temp.ok(public.create_platform_support_ticket(
  (select institute_id from pg_temp.fixtures), 'payments', 'Sandbox receipt question',
  'The sandbox receipt reference does not appear in my payment history.', (select request_key from pg_temp.fixtures)
) = (select ticket_id from pg_temp.fixtures), 'identical ticket retry returns the existing ticket');
select pg_temp.ok((select count(*) = 1 from public.platform_support_tickets where idempotency_key = (select request_key from pg_temp.fixtures)), 'ticket idempotency retry creates no duplicate');
do $$
declare item integer;
begin
  for item in 1..9 loop
    perform public.create_platform_support_ticket(
      (select institute_id from pg_temp.fixtures), 'other', 'Additional support request ' || item,
      'A separate support request created to exercise the daily limit.', gen_random_uuid()
    );
  end loop;
end;
$$;
select pg_temp.ok((select count(*) = 10 from public.platform_support_tickets where created_by = (select requester_id from pg_temp.fixtures) and status = 'open'), 'ten open requests reach the daily limit');
select pg_temp.ok(public.create_platform_support_ticket(
  (select institute_id from pg_temp.fixtures), 'payments', 'Sandbox receipt question',
  'The sandbox receipt reference does not appear in my payment history.', (select request_key from pg_temp.fixtures)
) = (select ticket_id from pg_temp.fixtures), 'identical idempotent retry succeeds at the daily limit');
do $$
begin
  begin
    perform public.create_platform_support_ticket((select institute_id from pg_temp.fixtures), 'other', 'Eleventh support request',
      'A separate support request beyond the daily limit.', gen_random_uuid());
    perform pg_temp.ok(false, 'new request is rejected at the daily limit');
  exception when sqlstate '54000' then perform pg_temp.ok(true, 'new request is rejected at the daily limit');
  end;
end;
$$;
do $$
begin
  begin
    perform public.create_platform_support_ticket((select institute_id from pg_temp.fixtures), 'payments', 'Changed subject',
      'The sandbox receipt reference does not appear in my payment history.', (select request_key from pg_temp.fixtures));
    perform pg_temp.ok(false, 'ticket key cannot be reused with changed input');
  exception when unique_violation then perform pg_temp.ok(true, 'ticket key cannot be reused with changed input');
  end;
  begin
    perform public.create_platform_support_ticket((select other_institute_id from pg_temp.fixtures), 'payments', 'Wrong institute',
      'The sandbox receipt reference does not appear in my payment history.', gen_random_uuid());
    perform pg_temp.ok(false, 'member cannot create a ticket for another institute');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'member cannot create a ticket for another institute');
  end;
end;
$$;
select pg_temp.ok((public.list_my_platform_support_tickets((select institute_id from pg_temp.fixtures))->>'total')::int = 10, 'member can read their institute support requests');
select set_config('request.jwt.claim.sub', (select outsider_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select outsider_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.list_my_platform_support_tickets((select institute_id from pg_temp.fixtures));
    perform pg_temp.ok(false, 'unrelated institute cannot list support tickets');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'unrelated institute cannot list support tickets');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select requester_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select requester_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
update pg_temp.fixtures f set message_id = public.reply_platform_support_ticket(f.ticket_id, 'I can share a redacted screenshot if needed.', f.reply_key);
select pg_temp.ok(exists(select 1 from public.platform_support_messages where id = (select message_id from pg_temp.fixtures) and author_kind = 'institute'), 'ticket creator can reply');
select pg_temp.ok(public.reply_platform_support_ticket((select ticket_id from pg_temp.fixtures), 'I can share a redacted screenshot if needed.', (select reply_key from pg_temp.fixtures)) = (select message_id from pg_temp.fixtures), 'identical reply retry returns the original message');
do $$
begin
  begin
    perform public.reply_platform_support_ticket((select ticket_id from pg_temp.fixtures), 'Different body for same key.', (select reply_key from pg_temp.fixtures));
    perform pg_temp.ok(false, 'reply key rejects changed content');
  exception when unique_violation then perform pg_temp.ok(true, 'reply key rejects changed content');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select platform_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select platform_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select public.set_platform_support_ticket_state((select ticket_id from pg_temp.fixtures), 'closed', 'high');
select pg_temp.ok(exists(select 1 from public.platform_support_tickets where id = (select ticket_id from pg_temp.fixtures) and status = 'closed' and priority = 'high' and closed_at is not null), 'platform support can close and prioritize a ticket');
select pg_temp.ok(exists(select 1 from public.platform_admin_audit_events where action = 'support_ticket_state_changed' and target_id = (select ticket_id::text from pg_temp.fixtures)), 'support state update creates an audit event');
do $$
begin
  begin
    perform public.reply_platform_support_ticket((select ticket_id from pg_temp.fixtures), 'Reply after close should fail.', gen_random_uuid());
    perform pg_temp.ok(false, 'closed ticket rejects new replies');
  exception when check_violation then perform pg_temp.ok(true, 'closed ticket rejects new replies');
  end;
end;
$$;
select pg_temp.ok((public.list_platform_support_tickets('closed')->'tickets'->0->>'id')::uuid = (select ticket_id from pg_temp.fixtures), 'platform support role can read the global queue');
select public.set_platform_support_ticket_state((select ticket_id from pg_temp.fixtures), 'open', 'normal');
select pg_temp.ok(exists(select 1 from public.platform_support_tickets where id = (select ticket_id from pg_temp.fixtures) and status = 'open' and closed_at is null), 'platform support can reopen a request');
select pg_temp.ok((select count(*) >= 2 from public.platform_admin_audit_events where target_id = (select ticket_id::text from pg_temp.fixtures) and action in ('support_ticket_state_changed', 'support_ticket_replied')), 'status changes and platform replies are audited');

select set_config('test.support_institute_id', (select institute_id from pg_temp.fixtures), true);
select set_config('request.jwt.claim.sub', (select outsider_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select outsider_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok((select count(*) = 0 from public.platform_support_tickets where institute_id = current_setting('test.support_institute_id')), 'RLS hides another institute ticket');
select pg_temp.ok((select count(*) = 0 from public.platform_support_messages where institute_id = current_setting('test.support_institute_id')), 'RLS hides another institute message thread');
reset role;

select * from pg_temp.finish();
do $$
declare expected_count integer; actual_count bigint; failure_count bigint;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed) into actual_count, failure_count from pg_temp.test_results;
  if actual_count <> expected_count or failure_count <> 0 then
    raise exception 'support test plan failed: % assertions, % failed, % planned', actual_count, failure_count, expected_count;
  end if;
end;
$$;
rollback;
