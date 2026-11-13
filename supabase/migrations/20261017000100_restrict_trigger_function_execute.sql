-- Tighten effective privileges on SECURITY DEFINER trigger functions.
-- These functions have no RPC use; execution is retained for authenticated
-- application DML and trusted database jobs so attached triggers keep working.
do $$
begin
  if to_regprocedure('bizbook_private.enforce_student_plan_limit()') is null
     or to_regprocedure('bizbook_private.enforce_staff_plan_limit()') is null
     or to_regprocedure('bizbook_private.enforce_branch_plan_limit()') is null
     or to_regprocedure('bizbook_private.guard_platform_provider_write()') is null then
    raise exception 'Expected BizBook plan-limit and provider-guard trigger functions are missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'students_plan_limit' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'staff_plan_limit' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'branches_plan_limit' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'platform_provider_connections_owner_write' and not tgisinternal) then
    raise exception 'Expected BizBook trigger attachments are missing';
  end if;
end;
$$;

revoke all on function bizbook_private.enforce_student_plan_limit() from public, anon, authenticated;
revoke all on function bizbook_private.enforce_staff_plan_limit() from public, anon, authenticated;
revoke all on function bizbook_private.enforce_branch_plan_limit() from public, anon, authenticated;
revoke all on function bizbook_private.guard_platform_provider_write() from public, anon, authenticated;

grant execute on function bizbook_private.enforce_student_plan_limit() to authenticated, service_role;
grant execute on function bizbook_private.enforce_staff_plan_limit() to authenticated, service_role;
grant execute on function bizbook_private.enforce_branch_plan_limit() to authenticated, service_role;
grant execute on function bizbook_private.guard_platform_provider_write() to authenticated, service_role;
