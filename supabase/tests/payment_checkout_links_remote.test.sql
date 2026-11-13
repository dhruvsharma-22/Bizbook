begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table fixture (
  owner_id uuid not null,
  institute_id text not null,
  student_id text not null,
  installment_id text not null,
  order_id text not null,
  first_hash text not null,
  second_hash text not null
);
create temporary table owner_seed (owner_id uuid not null, email text not null);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$
begin
  insert into pg_temp.test_results (passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.throws_ok(statement text, expected_state text, description text)
returns boolean language plpgsql as $$
declare actual_state text;
begin
  execute statement;
  insert into pg_temp.test_results (passed, description) values (false, description || ' (did not throw)');
  return false;
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate;
  insert into pg_temp.test_results (passed, description)
  values (actual_state = expected_state, description || case when actual_state = expected_state then '' else ' (SQLSTATE ' || actual_state || ')' end);
  return actual_state = expected_state;
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql as $$
declare item record; failures bigint;
begin
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no || ' - ' || item.description;
  end loop;
  select count(*) into failures from pg_temp.test_results where not passed;
  return next '# assertions=' || (select count(*)::text from pg_temp.test_results) || ' failed=' || failures;
end;
$$;
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;

insert into pg_temp.owner_seed values (
  gen_random_uuid(), 'checkout-link-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid'
);
insert into auth.users (id, aud, role, email)
select owner_id, 'authenticated', 'authenticated', email from pg_temp.owner_seed;
insert into pg_temp.fixture
select u.owner_id, 'checkout-link-' || replace(gen_random_uuid()::text, '-', ''),
  'checkout-student-' || replace(gen_random_uuid()::text, '-', ''),
  'checkout-installment-' || replace(gen_random_uuid()::text, '-', ''),
  'checkout-order-' || replace(gen_random_uuid()::text, '-', ''), repeat('a', 64), repeat('b', 64)
from pg_temp.owner_seed u;
insert into public.coaching_institutes (id, business_name)
select institute_id, 'Checkout Link Test Institute' from pg_temp.fixture;
insert into public.user_memberships (institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixture;
insert into public.students (id, institute_id, name)
select student_id, institute_id, 'Private Student Name' from pg_temp.fixture;
insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, due_date)
select installment_id, institute_id, student_id, 2, 100, current_date from pg_temp.fixture;
insert into public.payment_connections (institute_id, provider, environment, connection_status)
select institute_id, 'razorpay', 'test', 'active' from pg_temp.fixture;
insert into public.payment_orders (
  id, institute_id, branch_id, student_id, provider, provider_order_id, idempotency_key,
  amount, currency, order_status, created_by, receipt_kind, installment_id,
  allocation_amount, request_fingerprint
)
select order_id, institute_id, null, student_id, 'razorpay', 'order_checkout_link_test', 'checkout-link-test-key',
  100, 'INR', 'Pending', owner_id, 'Fee', installment_id, 100, repeat('c', 64)
from pg_temp.fixture;

select pg_temp.ok(
  not has_function_privilege('anon', 'public.create_payment_checkout_link(text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.revoke_payment_checkout_link(text)', 'EXECUTE'),
  'anonymous users cannot issue or revoke parent checkout links'
);
select pg_temp.ok(
  not has_function_privilege('anon', 'public.resolve_payment_checkout_link(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.resolve_payment_checkout_link(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.resolve_payment_checkout_link(text)', 'EXECUTE'),
  'checkout capability resolution is service-role-only'
);
select pg_temp.ok(
  not has_table_privilege('anon', 'public.payment_checkout_links', 'SELECT')
  and not has_table_privilege('authenticated', 'public.payment_checkout_links', 'SELECT'),
  'clients cannot read checkout-link token digests directly'
);
select pg_temp.ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_checkout_links'::regclass),
  'checkout-link table has row-level security enabled'
);

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixture), 'role', 'authenticated')::text, true);
select pg_temp.ok(
  (public.create_payment_checkout_link((select order_id from pg_temp.fixture), (select first_hash from pg_temp.fixture))->>'expires_at')::timestamptz > now(),
  'authorized institute owner can issue a short-lived checkout capability for a pending test installment order'
);
select pg_temp.ok(
  (select count(*) = 1 and bool_and(length(token_sha256) = 64)
     from public.payment_checkout_links where payment_order_id = (select order_id from pg_temp.fixture)),
  'only the token digest is stored'
);
select pg_temp.ok(
  exists(select 1 from public.audit_logs where entity_type = 'payment_checkout_link'
    and metadata->>'payment_order_id' = (select order_id from pg_temp.fixture)
    and not (metadata ? 'token_sha256')),
  'link issuance is audited without logging a token or token digest'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.ok(
  (public.resolve_payment_checkout_link((select first_hash from pg_temp.fixture))->>'installment_sequence')::integer = 2
  and public.resolve_payment_checkout_link((select first_hash from pg_temp.fixture))->>'institute_name' = 'Checkout Link Test Institute',
  'trusted resolution returns scoped checkout details'
);
select pg_temp.ok(
  not (public.resolve_payment_checkout_link((select first_hash from pg_temp.fixture)) ? 'student_name')
  and not (public.resolve_payment_checkout_link((select first_hash from pg_temp.fixture)) ? 'parent_email'),
  'public checkout resolution omits student and parent personal data'
);
select pg_temp.ok(
  public.resolve_payment_checkout_link(repeat('f', 64)) is null,
  'unknown token digest does not disclose order information'
);

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixture), 'role', 'authenticated')::text, true);
select pg_temp.ok(
  public.revoke_payment_checkout_link((select order_id from pg_temp.fixture)) = 1,
  'authorized finance user can revoke an active parent link'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.ok(
  public.resolve_payment_checkout_link((select first_hash from pg_temp.fixture)) is null,
  'revoked bearer capability can no longer resolve'
);

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixture), 'role', 'authenticated')::text, true);
select public.create_payment_checkout_link((select order_id from pg_temp.fixture), (select second_hash from pg_temp.fixture));
update public.payment_checkout_links set expires_at = now() - interval '1 minute'
 where token_sha256 = (select second_hash from pg_temp.fixture);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.ok(
  public.resolve_payment_checkout_link((select second_hash from pg_temp.fixture)) is null,
  'expired bearer capability can no longer resolve'
);

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixture), 'role', 'authenticated')::text, true);
update public.user_memberships set role = 'staff' where institute_id = (select institute_id from pg_temp.fixture);
select pg_temp.throws_ok(
  format('select public.create_payment_checkout_link(%L, %L)', (select order_id from pg_temp.fixture), repeat('d', 64)),
  '42501', 'ordinary staff cannot issue a payment capability'
);
update public.user_memberships set role = 'owner' where institute_id = (select institute_id from pg_temp.fixture);
update public.payment_orders set order_status = 'Failed' where id = (select order_id from pg_temp.fixture);
select pg_temp.throws_ok(
  format('select public.create_payment_checkout_link(%L, %L)', (select order_id from pg_temp.fixture), repeat('e', 64)),
  '23514', 'terminal payment order cannot receive a new parent checkout link'
);

select * from pg_temp.finish();
rollback;
