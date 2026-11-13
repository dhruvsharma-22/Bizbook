begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table provider_fixture (owner_id uuid, connection_id uuid);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin insert into pg_temp.test_results(passed, description) values (coalesce(passed, false), description); return coalesce(passed, false); end; $$;
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
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;
select pg_temp.plan(8);

select pg_temp.ok(not has_function_privilege('anon', 'public.record_platform_provider_sandbox_check(text,text,text,uuid)', 'EXECUTE'), 'anonymous sessions cannot record provider checks');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.record_platform_provider_sandbox_check(text,text,text,uuid)', 'EXECUTE'), 'browser sessions cannot claim a provider check succeeded');
select pg_temp.ok(has_function_privilege('service_role', 'public.record_platform_provider_sandbox_check(text,text,text,uuid)', 'EXECUTE'), 'only trusted server roles can record a provider check');

insert into auth.users(id, aud, role, email)
values (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-provider-check-owner@example.invalid');
insert into pg_temp.provider_fixture(owner_id, connection_id)
select id, gen_random_uuid() from auth.users where email = 'bizbook-provider-check-owner@example.invalid';
insert into public.platform_administrators(user_id, role)
select owner_id, 'owner' from pg_temp.provider_fixture;
select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.provider_fixture), true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.provider_fixture), 'role', 'service_role')::text, true);
insert into public.platform_provider_connections(id, provider_scope, provider, account_reference, environment, connection_status)
select connection_id, 'payment', 'razorpay', 'sandbox account', 'test', 'pending' from pg_temp.provider_fixture;

select public.record_platform_provider_sandbox_check('payment', 'razorpay', 'unpaid_order_created', (select owner_id from pg_temp.provider_fixture));
select pg_temp.ok(
  exists(select 1 from public.platform_provider_connections where id = (select connection_id from pg_temp.provider_fixture)
    and last_verified_at is not null and connection_status = 'pending'),
  'successful sandbox API check records a timestamp but keeps the connection pending'
);
select pg_temp.ok(
  exists(select 1 from public.platform_admin_audit_events where target_id = 'payment:razorpay'
    and action = 'provider_sandbox_check_succeeded' and actor_user_id = (select owner_id from pg_temp.provider_fixture)
    and details->>'status_remains' = 'pending'),
  'provider check creates an owner-attributed audit entry without provider secrets'
);

update public.platform_provider_connections set connection_status = 'disabled'
where id = (select connection_id from pg_temp.provider_fixture);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.record_platform_provider_sandbox_check('payment', 'razorpay', 'unpaid_order_created', (select owner_id from pg_temp.provider_fixture));
  exception when no_data_found then rejected := true;
  end;
  perform pg_temp.ok(rejected, 'disabled configurations cannot receive a successful pending-check timestamp');
end;
$$;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.record_platform_provider_sandbox_check('payment', 'resend', 'unpaid_order_created', (select owner_id from pg_temp.provider_fixture));
  exception when invalid_parameter_value then rejected := true;
  end;
  perform pg_temp.ok(rejected, 'mismatched provider and check types are rejected');
end;
$$;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.record_platform_provider_sandbox_check('payment', 'razorpay', 'unpaid_order_created', gen_random_uuid());
  exception when insufficient_privilege then rejected := true;
  end;
  perform pg_temp.ok(rejected, 'a trusted server cannot attribute a provider check to a non-owner');
end;
$$;

select * from pg_temp.finish();
rollback;
