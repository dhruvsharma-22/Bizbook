-- Tenant-aware membership helpers, institute onboarding and auditable row metadata.

create or replace function bizbook_private.has_institute_access(p_institute_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid()) and m.is_active
  );
$$;

create or replace function bizbook_private.has_institute_role(p_institute_id text, p_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and m.role = any (p_roles)
  );
$$;

create or replace function bizbook_private.can_access_branch(p_institute_id text, p_branch_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid()) and m.is_active
      and (
        p_branch_id is null
        or exists (
          select 1 from public.branches b
          where b.institute_id = p_institute_id and b.id = p_branch_id and b.is_active
        )
      )
      and (
        p_branch_id is null or m.access_scope = 'institute'
        or exists (
          select 1 from public.membership_branch_access mba
          where mba.institute_id = m.institute_id and mba.user_id = m.user_id
            and mba.branch_id = p_branch_id
        )
      )
  );
$$;

create or replace function bizbook_private.can_manage_institute(p_institute_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and m.access_scope = 'institute'
      and m.role in ('owner', 'administrator')
  );
$$;

create or replace function bizbook_private.can_write_branch(p_institute_id text, p_branch_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid()) and m.is_active
      and (
        p_branch_id is null
        or exists (
          select 1 from public.branches b
          where b.institute_id = p_institute_id and b.id = p_branch_id and b.is_active
        )
      )
      and (
        m.access_scope = 'institute'
        or (p_branch_id is not null and exists (
          select 1 from public.membership_branch_access mba
          where mba.institute_id = m.institute_id and mba.user_id = m.user_id
            and mba.branch_id = p_branch_id
        ))
      )
  );
$$;

revoke all on function bizbook_private.has_institute_access(text) from public;
revoke all on function bizbook_private.has_institute_role(text, text[]) from public;
revoke all on function bizbook_private.can_access_branch(text, text) from public;
revoke all on function bizbook_private.can_manage_institute(text) from public;
revoke all on function bizbook_private.can_write_branch(text, text) from public;
grant usage on schema bizbook_private to authenticated;
grant execute on function bizbook_private.has_institute_access(text) to authenticated;
grant execute on function bizbook_private.has_institute_role(text, text[]) to authenticated;
grant execute on function bizbook_private.can_access_branch(text, text) to authenticated;
grant execute on function bizbook_private.can_manage_institute(text) to authenticated;
grant execute on function bizbook_private.can_write_branch(text, text) to authenticated;

create or replace function public.create_coaching_institute(p_business_name text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_institute_id text;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if p_business_name is null or length(btrim(p_business_name)) not between 1 and 100 then
    raise exception 'Business name must contain 1 to 100 characters.' using errcode = '22023';
  end if;
  insert into public.coaching_institutes (business_name, created_by)
  values (btrim(p_business_name), v_user_id) returning id into v_institute_id;
  insert into public.profiles (id, display_name)
  values (v_user_id, nullif(auth.jwt()->'user_metadata'->>'name', ''))
  on conflict (id) do nothing;
  insert into public.user_memberships (institute_id, user_id, role, access_scope, created_by)
  values (v_institute_id, v_user_id, 'owner', 'institute', v_user_id);
  return v_institute_id;
end;
$$;

create or replace function public.grant_institute_membership(
  p_institute_id text, p_user_id uuid, p_role text, p_access_scope text default 'institute'
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_is_owner boolean;
  v_existing_role text;
  v_existing_access_scope text;
  v_existing_active boolean;
begin
  if v_actor_id is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if p_institute_id is null or p_user_id is null or p_role is null
     or p_role not in ('owner', 'administrator', 'accountant', 'staff')
     or p_access_scope is null or p_access_scope not in ('institute', 'branches') then
    raise exception 'Membership role or scope is invalid.' using errcode = '22023';
  end if;
  perform 1 from public.coaching_institutes i where i.id = p_institute_id for update;
  if not found or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  select m.role = 'owner' into v_actor_is_owner
  from public.user_memberships m
  where m.institute_id = p_institute_id and m.user_id = v_actor_id and m.is_active;
  if p_role in ('owner', 'administrator') and not coalesce(v_actor_is_owner, false) then
    raise exception 'Only an institute owner may grant owner or administrator roles.' using errcode = '42501';
  end if;
  if p_user_id = v_actor_id and (p_role <> 'owner' or p_access_scope <> 'institute') then
    raise exception 'A user cannot change their own role through this function.' using errcode = '42501';
  end if;
  select m.role, m.access_scope, m.is_active
  into v_existing_role, v_existing_access_scope, v_existing_active
  from public.user_memberships m
  where m.institute_id = p_institute_id and m.user_id = p_user_id for update;
  if v_existing_role = 'owner' and not coalesce(v_actor_is_owner, false) then
    raise exception 'Only an institute owner may change an owner membership.' using errcode = '42501';
  end if;
  if found and (v_existing_access_scope is distinct from p_access_scope or not v_existing_active) then
    delete from public.membership_branch_access
    where institute_id = p_institute_id and user_id = p_user_id;
  end if;
  insert into public.user_memberships (institute_id, user_id, role, access_scope, is_active, created_by)
  values (p_institute_id, p_user_id, p_role, p_access_scope, true, v_actor_id)
  on conflict (institute_id, user_id) do update
    set role = excluded.role, access_scope = excluded.access_scope,
        is_active = true, updated_at = now();
end;
$$;

create or replace function public.deactivate_institute_membership(p_institute_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target_role text;
  v_actor_is_owner boolean;
  v_active_owner_count integer;
begin
  if v_actor_id is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if p_institute_id is null or p_user_id is null then
    raise exception 'Institute and user are required.' using errcode = '22023';
  end if;
  perform 1 from public.coaching_institutes i where i.id = p_institute_id for update;
  if not found or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if p_user_id = v_actor_id then
    raise exception 'A user cannot deactivate their own membership.' using errcode = '42501';
  end if;
  select m.role into v_target_role from public.user_memberships m
  where m.institute_id = p_institute_id and m.user_id = p_user_id and m.is_active for update;
  if not found then
    raise exception 'An active membership was not found.' using errcode = '22023';
  end if;
  select m.role = 'owner' into v_actor_is_owner from public.user_memberships m
  where m.institute_id = p_institute_id and m.user_id = v_actor_id and m.is_active;
  if v_target_role = 'owner' and not coalesce(v_actor_is_owner, false) then
    raise exception 'Only an institute owner may deactivate another owner.' using errcode = '42501';
  end if;
  if v_target_role = 'owner' then
    select count(*) into v_active_owner_count from public.user_memberships m
    where m.institute_id = p_institute_id and m.role = 'owner' and m.is_active;
    if v_active_owner_count <= 1 then
      raise exception 'Transfer ownership before deactivating the last active owner.' using errcode = '23514';
    end if;
  end if;
  delete from public.membership_branch_access
  where institute_id = p_institute_id and user_id = p_user_id;
  update public.user_memberships set is_active = false, updated_at = now()
  where institute_id = p_institute_id and user_id = p_user_id;
end;
$$;

create or replace function public.set_membership_branch_access(
  p_institute_id text, p_user_id uuid, p_branch_id text, p_granted boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if p_institute_id is null or p_user_id is null or p_branch_id is null or p_granted is null then
    raise exception 'Institute, user, branch and access decision are required.' using errcode = '22023';
  end if;
  perform 1 from public.coaching_institutes i where i.id = p_institute_id for update;
  if not found or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_memberships m
    where m.institute_id = p_institute_id and m.user_id = p_user_id
      and m.is_active and m.access_scope = 'branches'
  ) then
    raise exception 'An active branch-scoped membership is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.branches b
    where b.institute_id = p_institute_id and b.id = p_branch_id and b.is_active
  ) then
    raise exception 'The selected branch is unavailable.' using errcode = '22023';
  end if;
  if p_granted then
    insert into public.membership_branch_access (institute_id, user_id, branch_id, granted_by)
    values (p_institute_id, p_user_id, p_branch_id, auth.uid()) on conflict do nothing;
  else
    delete from public.membership_branch_access
    where institute_id = p_institute_id and user_id = p_user_id and branch_id = p_branch_id;
  end if;
end;
$$;

revoke all on function public.create_coaching_institute(text) from public, anon;
revoke all on function public.grant_institute_membership(text, uuid, text, text) from public, anon;
revoke all on function public.deactivate_institute_membership(text, uuid) from public, anon;
revoke all on function public.set_membership_branch_access(text, uuid, text, boolean) from public, anon;
grant execute on function public.create_coaching_institute(text) to authenticated;
grant execute on function public.grant_institute_membership(text, uuid, text, text) to authenticated;
grant execute on function public.deactivate_institute_membership(text, uuid) to authenticated;
grant execute on function public.set_membership_branch_access(text, uuid, text, boolean) to authenticated;

create or replace function bizbook_private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function bizbook_private.validate_institute_time_zone()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.time_zone
  ) then
    raise exception 'Institute time zone must be a valid IANA time zone.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function bizbook_private.audit_row_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_institute_id text;
  v_branch_id text;
  v_entity_id text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_institute_id := coalesce(v_row->>'institute_id', case when tg_table_name = 'coaching_institutes' then v_row->>'id' end);
  v_branch_id := v_row->>'branch_id';
  v_entity_id := coalesce(
    v_row->>'id',
    nullif(concat_ws(':', v_row->>'staff_id', v_row->>'payroll_month'), ''),
    v_row->>'user_id',
    v_row->>'branch_id',
    v_row->>'student_id'
  );
  if v_institute_id is not null and v_entity_id is not null then
    insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id)
    values (v_institute_id, v_branch_id, tg_table_name, v_entity_id, tg_op, auth.uid());
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function bizbook_private.prevent_institute_transfer()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'coaching_institutes' then
    if (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id') then
      raise exception 'Institute identifiers are immutable.' using errcode = '23514';
    end if;
  elsif (to_jsonb(new)->>'institute_id') is distinct from (to_jsonb(old)->>'institute_id') then
    raise exception 'A record cannot be moved between institutes.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function bizbook_private.guard_installment_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_net_paid numeric(12,2);
begin
  select greatest(0::numeric,
    coalesce((select sum(pa.amount)
      from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
      where pa.institute_id = old.institute_id and pa.installment_id = old.id
        and p.status in ('Paid', 'Partially Refunded', 'Refunded')), 0)
    - coalesce((select sum(ra.amount)
      from public.refund_allocations ra
      join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
      join public.payment_allocations pa on pa.id = ra.payment_allocation_id and pa.institute_id = ra.institute_id
      where pa.institute_id = old.institute_id and pa.installment_id = old.id and r.status = 'Completed'), 0)
  ) into v_net_paid;
  if new.scheduled_amount < v_net_paid then
    raise exception 'Scheduled amount cannot be reduced below the installment paid amount.' using errcode = '23514';
  end if;
  if new.status = 'Paid' and v_net_paid < new.scheduled_amount then
    raise exception 'An installment cannot be marked paid while a balance remains.' using errcode = '23514';
  end if;
  if new.status = 'Cancelled' and old.status <> 'Cancelled' and v_net_paid > 0 then
    raise exception 'An installment with a net payment cannot be cancelled.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function bizbook_private.guard_expense_date()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_time_zone text;
  v_business_date date;
begin
  select i.time_zone, (now() at time zone i.time_zone)::date
    into v_time_zone, v_business_date
  from public.coaching_institutes i where i.id = new.institute_id;
  if found and new.expense_date > v_business_date then
    raise exception 'Expense date cannot be in the future.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function bizbook_private.bump_reminder_schedule_version()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.due_date is distinct from old.due_date then
    new.reminder_schedule_version := old.reminder_schedule_version + 1;
  end if;
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function bizbook_private.set_updated_at();
create trigger institutes_updated_at before update on public.coaching_institutes for each row execute function bizbook_private.set_updated_at();
create trigger institutes_time_zone_valid before insert or update of time_zone on public.coaching_institutes
for each row execute function bizbook_private.validate_institute_time_zone();
create trigger memberships_updated_at before update on public.user_memberships for each row execute function bizbook_private.set_updated_at();
create trigger branches_updated_at before update on public.branches for each row execute function bizbook_private.set_updated_at();
create trigger students_updated_at before update on public.students for each row execute function bizbook_private.set_updated_at();
create trigger staff_updated_at before update on public.staff for each row execute function bizbook_private.set_updated_at();
create trigger attendance_updated_at before update on public.attendance_records for each row execute function bizbook_private.set_updated_at();
create trigger installments_updated_at before update on public.student_installments for each row execute function bizbook_private.set_updated_at();
create trigger installment_reminder_schedule_version before update of due_date on public.student_installments
for each row execute function bizbook_private.bump_reminder_schedule_version();
create trigger expenses_date_guard before insert or update of expense_date on public.expenses
for each row execute function bizbook_private.guard_expense_date();
create trigger payments_updated_at before update on public.payments for each row execute function bizbook_private.set_updated_at();
create trigger refunds_updated_at before update on public.refunds for each row execute function bizbook_private.set_updated_at();
create trigger salary_payments_updated_at before update on public.salary_payments for each row execute function bizbook_private.set_updated_at();
create trigger expenses_updated_at before update on public.expenses for each row execute function bizbook_private.set_updated_at();
create trigger payment_connections_updated_at before update on public.payment_connections for each row execute function bizbook_private.set_updated_at();
create trigger payment_orders_updated_at before update on public.payment_orders for each row execute function bizbook_private.set_updated_at();

create trigger institutes_id_immutable before update on public.coaching_institutes
for each row when (new.id is distinct from old.id)
execute function bizbook_private.prevent_institute_transfer();
create trigger memberships_tenant_immutable before update on public.user_memberships
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger branches_tenant_immutable before update on public.branches
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger students_tenant_immutable before update on public.students
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger staff_tenant_immutable before update on public.staff
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger attendance_tenant_immutable before update on public.attendance_records
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger installments_tenant_immutable before update on public.student_installments
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger payments_tenant_immutable before update on public.payments
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger allocations_tenant_immutable before update on public.payment_allocations
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger refunds_tenant_immutable before update on public.refunds
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger refund_allocations_tenant_immutable before update on public.refund_allocations
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger salary_payments_tenant_immutable before update on public.salary_payments
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger expenses_tenant_immutable before update on public.expenses
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger audit_logs_tenant_immutable before update on public.audit_logs
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger notification_logs_tenant_immutable before update on public.notification_logs
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger payment_connections_tenant_immutable before update on public.payment_connections
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger payment_orders_tenant_immutable before update on public.payment_orders
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger webhook_events_tenant_immutable before update on public.webhook_events
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger reconciliation_tenant_immutable before update on public.payment_reconciliation_records
for each row execute function bizbook_private.prevent_institute_transfer();
create trigger installment_balance_guard before update of scheduled_amount, status on public.student_installments
for each row execute function bizbook_private.guard_installment_changes();

create trigger students_audit after insert or update or delete on public.students for each row execute function bizbook_private.audit_row_change();
create trigger institutes_audit after insert or update or delete on public.coaching_institutes for each row execute function bizbook_private.audit_row_change();
create trigger memberships_audit after insert or update or delete on public.user_memberships for each row execute function bizbook_private.audit_row_change();
create trigger branch_access_audit after insert or update or delete on public.membership_branch_access for each row execute function bizbook_private.audit_row_change();
create trigger branches_audit after insert or update or delete on public.branches for each row execute function bizbook_private.audit_row_change();
create trigger staff_audit after insert or update or delete on public.staff for each row execute function bizbook_private.audit_row_change();
create trigger attendance_audit after insert or update or delete on public.attendance_records for each row execute function bizbook_private.audit_row_change();
create trigger installments_audit after insert or update or delete on public.student_installments for each row execute function bizbook_private.audit_row_change();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function bizbook_private.audit_row_change();
create trigger allocations_audit after insert or update or delete on public.payment_allocations for each row execute function bizbook_private.audit_row_change();
create trigger refunds_audit after insert or update or delete on public.refunds for each row execute function bizbook_private.audit_row_change();
create trigger refund_allocations_audit after insert or update or delete on public.refund_allocations for each row execute function bizbook_private.audit_row_change();
create trigger salary_payments_audit after insert or update or delete on public.salary_payments for each row execute function bizbook_private.audit_row_change();
create trigger expenses_audit after insert or update or delete on public.expenses for each row execute function bizbook_private.audit_row_change();

revoke all on function bizbook_private.set_updated_at() from public;
revoke all on function bizbook_private.audit_row_change() from public;
revoke all on function bizbook_private.prevent_institute_transfer() from public;
revoke all on function bizbook_private.guard_installment_changes() from public;

