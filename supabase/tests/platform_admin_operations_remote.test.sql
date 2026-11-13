begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixtures (owner_id uuid, support_id uuid, institute_id text, plan_id uuid, invoice_id uuid, invoice_number text);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results (passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$ begin insert into pg_temp.test_plan values (expected); return '1..' || expected::text; end; $$;
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
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;
select pg_temp.plan(28);

insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-platform-owner-test@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-platform-support-test@example.invalid');
insert into pg_temp.fixtures(owner_id, support_id, institute_id, invoice_number)
select
  (select id from auth.users where email = 'bizbook-platform-owner-test@example.invalid'),
  (select id from auth.users where email = 'bizbook-platform-support-test@example.invalid'),
  'platform-admin-ops-' || replace(gen_random_uuid()::text, '-', ''),
  'BBTEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
do $$
declare
  v_already_initialized boolean := exists(select 1 from public.platform_administrators);
begin
  if v_already_initialized then
    begin
      perform public.provision_first_platform_owner((select owner_id from pg_temp.fixtures));
      perform pg_temp.ok(false, 'first-owner provisioning refuses to replace an existing administrator set');
    exception when unique_violation then
      perform pg_temp.ok(true, 'first-owner provisioning refuses to replace an existing administrator set');
    end;
    -- Use a transaction-local synthetic owner for the remainder of these authorization tests.
    -- The suite rolls back, so this never changes the test project's existing administrator.
    insert into public.platform_administrators(user_id, role, granted_by)
    select owner_id, 'owner', null from pg_temp.fixtures;
  else
    perform public.provision_first_platform_owner((select owner_id from pg_temp.fixtures));
    perform pg_temp.ok(
      exists(select 1 from public.platform_administrators where user_id = (select owner_id from pg_temp.fixtures) and role = 'owner'),
      'trusted service role can provision the first owner without a browser bootstrap'
    );
  end if;
  perform pg_temp.ok(
    not has_function_privilege('authenticated', 'public.provision_first_platform_owner(uuid)', 'EXECUTE'),
    'authenticated sessions cannot invoke first-owner provisioning'
  );
  begin
    perform public.provision_first_platform_owner((select support_id from pg_temp.fixtures));
    perform pg_temp.ok(false, 'first-owner provisioning cannot run twice');
  exception when unique_violation then
    perform pg_temp.ok(true, 'first-owner provisioning cannot run twice');
  end;
end;
$$;

insert into public.coaching_institutes(id, business_name)
select institute_id, 'Platform Admin Operations Test' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);

select pg_temp.ok(public.is_platform_administrator(), 'the public RPC wrapper used by the server authorization guard is available');
select pg_temp.ok(bizbook_private.has_platform_role(array['owner']::text[]), 'platform owner role capability is resolved from the database');
select pg_temp.ok((public.platform_admin_overview_safe(null, 100, 0)->>'current_role') = 'owner', 'role-aware overview returns the database-authorized role and records');

update pg_temp.fixtures set plan_id = public.save_platform_subscription_plan(
  null, 'Platform Test Plan', 'temporary test plan', 100.50, 1000.25, 14, 1, 1, 1, '{}'::jsonb, true
);
select pg_temp.ok(exists(select 1 from public.platform_subscription_plans where id = (select plan_id from pg_temp.fixtures)), 'owner can create a subscription plan');
select pg_temp.ok(exists(select 1 from public.platform_admin_audit_events where target_id = (select plan_id::text from pg_temp.fixtures) and action = 'subscription_plan_created'), 'plan creation is audited');

select public.assign_platform_subscription(
  f.institute_id, f.plan_id, 'active', 'monthly', null, now(), now() + interval '1 month', null
) from pg_temp.fixtures f;
select pg_temp.ok(exists(select 1 from public.institute_subscriptions where institute_id = (select institute_id from pg_temp.fixtures) and plan_id = (select plan_id from pg_temp.fixtures)), 'subscription assignment is stored for the selected institute');
select pg_temp.ok(exists(select 1 from public.platform_subscription_events where institute_id = (select institute_id from pg_temp.fixtures) and event_type = 'subscription_assigned'), 'subscription assignment creates an event history row');

update pg_temp.fixtures set invoice_id = (public.issue_platform_subscription_invoice(
  institute_id, invoice_number, now(), now() + interval '1 month', now() + interval '7 days'
)->>'invoice_id')::uuid;
select pg_temp.ok(exists(select 1 from public.platform_subscription_invoices where id = (select invoice_id from pg_temp.fixtures) and amount = 100.50 and status = 'open'), 'invoice amount is derived from the assigned plan and remains open');
select pg_temp.ok((public.issue_platform_subscription_invoice(
  (select institute_id from pg_temp.fixtures), (select invoice_number from pg_temp.fixtures),
  (select billing_period_start from public.platform_subscription_invoices where id = (select invoice_id from pg_temp.fixtures)),
  (select billing_period_end from public.platform_subscription_invoices where id = (select invoice_id from pg_temp.fixtures)), null
)->>'created')::boolean = false, 'retrying an identical invoice number returns the existing invoice without duplicating it');
select pg_temp.ok((select count(*) from public.platform_subscription_invoices where invoice_number = (select invoice_number from pg_temp.fixtures)) = 1, 'invoice retries create only one invoice row');

insert into public.students(id, institute_id, name)
select 'platform-limit-student-1', institute_id, 'Limit Test One' from pg_temp.fixtures;
do $$
declare rejected boolean := false; limit_error text;
begin
  begin
    insert into public.students(id, institute_id, name)
    select 'platform-limit-student-2', institute_id, 'Limit Test Two' from pg_temp.fixtures;
  exception when check_violation then
    get stacked diagnostics limit_error = message_text;
    rejected := limit_error = 'PLAN_LIMIT_REACHED|students|1|1';
  end;
  perform pg_temp.ok(rejected, 'student cap rejects writes and reports exact active usage and limit');
end;
$$;
update public.students set archived_at = now() where id = 'platform-limit-student-1';
insert into public.students(id, institute_id, name)
select 'platform-limit-student-3', institute_id, 'Limit Test Three' from pg_temp.fixtures;
select pg_temp.ok((select count(*) from public.students where institute_id = (select institute_id from pg_temp.fixtures) and archived_at is null) = 1, 'archived students no longer consume the active student limit');

insert into public.staff(id, institute_id, name)
select 'platform-limit-staff-1', institute_id, 'Limit Staff One' from pg_temp.fixtures;
do $$
declare rejected boolean := false; limit_error text;
begin
  begin
    insert into public.staff(id, institute_id, name)
    select 'platform-limit-staff-2', institute_id, 'Limit Staff Two' from pg_temp.fixtures;
  exception when check_violation then
    get stacked diagnostics limit_error = message_text;
    rejected := limit_error = 'PLAN_LIMIT_REACHED|staff|1|1';
  end;
  perform pg_temp.ok(rejected, 'staff cap rejects writes and reports exact active usage and limit');
end;
$$;
insert into public.branches(id, institute_id, name, branch_login_email)
select 'platform-limit-branch-1', institute_id, 'Limit Branch One', 'platform-limit-branch-1@example.invalid' from pg_temp.fixtures;
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.branches(id, institute_id, name, branch_login_email)
    select 'platform-limit-branch-2', institute_id, 'Limit Branch Two', 'platform-limit-branch-2@example.invalid' from pg_temp.fixtures;
  exception when check_violation then rejected := true;
  end;
  perform pg_temp.ok(rejected, 'branch cap rejects additional active branches');
end;
$$;

select pg_temp.ok(bizbook_private.has_institute_access((select institute_id from pg_temp.fixtures)), 'active institute membership remains accessible');
select public.set_platform_institute_status((select institute_id from pg_temp.fixtures), 'suspended', 'remote regression test');
select pg_temp.ok(not bizbook_private.has_institute_access((select institute_id from pg_temp.fixtures)), 'suspended institutes lose tenant access at the database authorization layer');
select pg_temp.ok(not bizbook_private.can_manage_institute((select institute_id from pg_temp.fixtures)), 'suspended institutes block tenant management operations');
select public.set_platform_institute_status((select institute_id from pg_temp.fixtures), 'active', 'reactivation regression test');
select pg_temp.ok(bizbook_private.has_institute_access((select institute_id from pg_temp.fixtures)), 'reactivating the institute restores existing membership access');

select public.set_platform_admin_role((select support_id from pg_temp.fixtures), 'support');
select set_config('request.jwt.claim.sub', (select support_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select support_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.set_platform_institute_status((select institute_id from pg_temp.fixtures), 'suspended', 'must be denied');
  exception when insufficient_privilege then rejected := true;
  end;
  perform pg_temp.ok(rejected, 'support role cannot suspend institutes');
end;
$$;
select pg_temp.ok(not bizbook_private.has_platform_role(array['owner']::text[]), 'support role does not gain owner capability');

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
declare
  rejected boolean := false;
  owner_count integer;
begin
  select count(*) into owner_count from public.platform_administrators where role = 'owner';
  if owner_count <= 1 then
    begin
      perform public.set_platform_admin_role((select owner_id from pg_temp.fixtures), 'operator');
    exception when check_violation then rejected := true;
    end;
    perform pg_temp.ok(rejected, 'the last platform owner cannot demote themselves');
  else
    perform public.set_platform_admin_role((select owner_id from pg_temp.fixtures), 'operator');
    perform pg_temp.ok(
      exists(select 1 from public.platform_administrators where role = 'owner'),
      'an owner can be demoted while another platform owner remains'
    );
  end if;
end;
$$;
select pg_temp.ok(
  not has_table_privilege('authenticated', 'public.coaching_institutes', 'UPDATE'),
  'tenant institute rows cannot be changed directly by browser sessions'
);
select pg_temp.ok(
  exists(select 1 from pg_trigger where tgname = 'students_plan_limit' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname = 'staff_plan_limit' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname = 'branches_plan_limit' and not tgisinternal),
  'student, staff and branch limits are enforced by database triggers'
);
select pg_temp.ok(
  not has_function_privilege('anon', 'bizbook_private.enforce_student_plan_limit()', 'EXECUTE')
  and not has_function_privilege('anon', 'bizbook_private.enforce_staff_plan_limit()', 'EXECUTE')
  and not has_function_privilege('anon', 'bizbook_private.enforce_branch_plan_limit()', 'EXECUTE')
  and not has_function_privilege('anon', 'bizbook_private.guard_platform_provider_write()', 'EXECUTE'),
  'anonymous callers cannot execute privileged application trigger functions'
);
select pg_temp.ok(
  has_function_privilege('authenticated', 'bizbook_private.enforce_student_plan_limit()', 'EXECUTE')
  and has_function_privilege('authenticated', 'bizbook_private.enforce_staff_plan_limit()', 'EXECUTE')
  and has_function_privilege('authenticated', 'bizbook_private.enforce_branch_plan_limit()', 'EXECUTE')
  and has_function_privilege('authenticated', 'bizbook_private.guard_platform_provider_write()', 'EXECUTE'),
  'authorized application writes retain the privileges required by attached triggers'
);

select * from pg_temp.finish();
rollback;
