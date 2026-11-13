-- RLS applies to every private application table. No anonymous financial access is granted.

alter table public.profiles enable row level security;
alter table public.coaching_institutes enable row level security;
alter table public.user_memberships enable row level security;
alter table public.branches enable row level security;
alter table public.membership_branch_access enable row level security;
alter table public.students enable row level security;
alter table public.staff enable row level security;
alter table public.attendance_records enable row level security;
alter table public.student_installments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.refunds enable row level security;
alter table public.refund_allocations enable row level security;
alter table public.salary_payments enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notification_logs enable row level security;
alter table public.payment_connections enable row level security;
alter table public.payment_orders enable row level security;
alter table public.webhook_events enable row level security;
alter table public.payment_reconciliation_records enable row level security;

create policy profiles_select_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy institutes_select_member on public.coaching_institutes for select to authenticated
  using (bizbook_private.has_institute_access(id));
create policy institutes_update_manager on public.coaching_institutes for update to authenticated
  using (bizbook_private.can_manage_institute(id)) with check (bizbook_private.can_manage_institute(id));

create policy memberships_select_self_or_manager on public.user_memberships for select to authenticated
  using (user_id = (select auth.uid()) or bizbook_private.can_manage_institute(institute_id));
create policy branch_access_select_self_or_manager on public.membership_branch_access for select to authenticated
  using (user_id = (select auth.uid()) or bizbook_private.can_manage_institute(institute_id));

create policy branches_select_accessible on public.branches for select to authenticated
  using (bizbook_private.can_access_branch(institute_id, id));
create policy branches_insert_manager on public.branches for insert to authenticated
  with check (bizbook_private.can_manage_institute(institute_id));
create policy branches_update_manager on public.branches for update to authenticated
  using (bizbook_private.can_manage_institute(institute_id))
  with check (bizbook_private.can_manage_institute(institute_id));

create policy students_select_accessible on public.students for select to authenticated
  using (bizbook_private.can_access_branch(institute_id, branch_id));
create policy students_insert_manager on public.students for insert to authenticated
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));
create policy students_update_manager on public.students for update to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id))
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));

create policy staff_select_accessible on public.staff for select to authenticated
  using (bizbook_private.can_access_branch(institute_id, branch_id));
create policy staff_insert_manager on public.staff for insert to authenticated
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));
create policy staff_update_manager on public.staff for update to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id))
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));

create policy attendance_select_accessible on public.attendance_records for select to authenticated
  using (bizbook_private.can_access_branch(institute_id, branch_id));
create policy attendance_insert_authorized on public.attendance_records for insert to authenticated
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant', 'staff']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));
create policy attendance_update_authorized on public.attendance_records for update to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant', 'staff']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id))
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant', 'staff']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));

create policy installments_select_accessible on public.student_installments for select to authenticated
  using (bizbook_private.can_access_branch(institute_id, branch_id));
create policy installments_insert_finance on public.student_installments for insert to authenticated
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));
create policy installments_update_finance on public.student_installments for update to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id))
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));

create policy payments_select_finance on public.payments for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy allocations_select_finance on public.payment_allocations for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and exists (
      select 1 from public.student_installments i
      where i.id = payment_allocations.installment_id and i.institute_id = payment_allocations.institute_id
        and bizbook_private.can_access_branch(i.institute_id, i.branch_id)
    ));
create policy refunds_select_finance on public.refunds for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy refund_allocations_select_finance on public.refund_allocations for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and exists (
      select 1 from public.refunds r
      where r.id = refund_allocations.refund_id and r.institute_id = refund_allocations.institute_id
        and bizbook_private.can_access_branch(r.institute_id, r.branch_id)
    ));

create policy salary_payments_select_finance on public.salary_payments for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy expenses_select_finance on public.expenses for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy expenses_insert_finance on public.expenses for insert to authenticated
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));
create policy expenses_update_finance on public.expenses for update to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id))
  with check (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_write_branch(institute_id, branch_id));

create policy audit_logs_select_manager on public.audit_logs for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id)
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy notification_logs_select_manager on public.notification_logs for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id)
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy payment_connections_select_manager on public.payment_connections for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
create policy payment_orders_select_finance on public.payment_orders for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id));
create policy reconciliation_select_finance on public.payment_reconciliation_records for select to authenticated
  using (bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[]));
-- webhook_events has no authenticated policy: trusted server processing only.

revoke all on table
  public.profiles, public.coaching_institutes, public.user_memberships, public.branches,
  public.membership_branch_access, public.students, public.staff, public.attendance_records,
  public.student_installments, public.payments, public.payment_allocations, public.refunds,
  public.refund_allocations, public.salary_payments, public.expenses, public.audit_logs,
  public.notification_logs, public.payment_connections, public.payment_orders,
  public.webhook_events, public.payment_reconciliation_records
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.coaching_institutes to authenticated;
grant update (business_name, owner_name, phone, whatsapp, email, website, address, city, state, pincode, gstin, time_zone)
  on public.coaching_institutes to authenticated;
grant select on public.user_memberships, public.membership_branch_access to authenticated;
grant select on public.branches to authenticated;
grant insert (institute_id, name, address, phone, is_active) on public.branches to authenticated;
grant update (name, address, phone, is_active) on public.branches to authenticated;
grant select on public.students to authenticated;
grant insert (id, institute_id, branch_id, name, gender, parent_name, parent_email, parent_email_opt_in, whatsapp_opt_in, parent_mobile, whatsapp,
  course, class_name, admission_date, total_fee, admission_fee, legacy_data) on public.students to authenticated;
grant update (branch_id, name, gender, parent_name, parent_email, parent_email_opt_in, whatsapp_opt_in, parent_mobile, whatsapp, course, class_name,
  admission_date, total_fee, admission_fee, archived_at, legacy_data) on public.students to authenticated;
grant select on public.staff to authenticated;
grant insert (id, institute_id, branch_id, name, gender, mobile, whatsapp, designation,
  joining_date, monthly_salary, payment_day, per_day_leave_cut, manual_payable_amount, salary_calculation_mode,
  attendance_enabled, legacy_data) on public.staff to authenticated;
grant update (branch_id, name, gender, mobile, whatsapp, designation, joining_date, monthly_salary,
  payment_day, per_day_leave_cut, manual_payable_amount, salary_calculation_mode, attendance_enabled, archived_at, legacy_data)
  on public.staff to authenticated;
grant select on public.attendance_records to authenticated;
grant insert (id, institute_id, branch_id, staff_id, attendance_date, status, note)
  on public.attendance_records to authenticated;
grant update (branch_id, status, note) on public.attendance_records to authenticated;
grant select on public.student_installments to authenticated;
grant insert (id, institute_id, branch_id, student_id, sequence_number, scheduled_amount, due_date, status, legacy_data)
  on public.student_installments to authenticated;
grant update (branch_id, sequence_number, scheduled_amount, due_date, status, legacy_data)
  on public.student_installments to authenticated;
grant select on public.payments, public.payment_allocations, public.refunds, public.refund_allocations,
  public.salary_payments, public.expenses, public.audit_logs, public.notification_logs,
  public.payment_orders, public.payment_reconciliation_records
  to authenticated;
grant select (id, institute_id, provider, merchant_account_reference, environment, connection_status, created_at, updated_at)
  on public.payment_connections to authenticated;
grant insert (institute_id, branch_id, title, category, amount, expense_date, method, notes, legacy_data)
  on public.expenses to authenticated;
grant update (branch_id, title, category, amount, expense_date, method, notes, legacy_data)
  on public.expenses to authenticated;
grant select on public.installment_balances, public.advance_balances, public.payment_history,
  public.financial_activity to authenticated;
grant select on public.installment_balances to service_role;

grant all on table
  public.profiles, public.coaching_institutes, public.user_memberships, public.branches,
  public.membership_branch_access, public.students, public.staff, public.attendance_records,
  public.student_installments, public.payments, public.payment_allocations, public.refunds,
  public.refund_allocations, public.salary_payments, public.expenses, public.audit_logs,
  public.notification_logs, public.payment_connections, public.payment_orders, public.webhook_events,
  public.payment_reconciliation_records
to service_role;

comment on function public.record_manual_payment(text, text, text, text, numeric, text, date, text, text, jsonb, text, text)
  is 'Records a manual receipt once and applies optional installment allocations atomically.';
comment on function public.allocate_advance(text, text, numeric)
  is 'Applies existing unallocated receipt balance; no new inflow is created.';
comment on function public.request_refund(text, numeric, text, text, jsonb, text)
  is 'Pending refunds reserve balance; online completion requires external provider confirmation.';
comment on function public.complete_manual_refund(text)
  is 'Only manual refunds can be completed by an authenticated user.';

