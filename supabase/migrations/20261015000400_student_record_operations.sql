-- Student master data and fee schedules are stored atomically. This does not
-- import, rewrite, or remove any legacy browser data.

alter table public.student_installments
  drop constraint if exists student_installments_sequence_number_check;
alter table public.student_installments
  add constraint student_installments_sequence_number_check check (sequence_number >= 0);

create or replace view public.installment_balances
with (security_invoker = true)
as
select
  i.id as installment_id,
  i.institute_id,
  i.branch_id,
  i.student_id,
  i.sequence_number,
  i.scheduled_amount,
  i.due_date,
  i.status as scheduled_status,
  greatest(0::numeric, coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0))::numeric(12,2) as paid_amount,
  case when i.status = 'Cancelled' then 0::numeric(12,2)
    else greatest(0::numeric, i.scheduled_amount - greatest(0::numeric, coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0)))::numeric(12,2)
  end as outstanding_amount,
  case
    when i.status = 'Cancelled' then 'Cancelled'
    when greatest(0::numeric, i.scheduled_amount - greatest(0::numeric, coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0))) = 0 then 'Paid'
    when coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0) > 0 then 'Partially Paid'
    when i.due_date is not null and i.due_date < (now() at time zone inst.time_zone)::date then 'Overdue'
    else 'Pending'
  end as balance_status,
  i.legacy_data
from public.student_installments i
join public.coaching_institutes inst on inst.id = i.institute_id
left join lateral (
  select sum(pa.amount) as allocated_amount
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
  where pa.institute_id = i.institute_id
    and pa.installment_id = i.id
    and p.status in ('Paid', 'Partially Refunded', 'Refunded')
) a on true
left join lateral (
  select sum(ra.amount) as refunded_amount
  from public.refund_allocations ra
  join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
  where ra.institute_id = i.institute_id
    and ra.payment_allocation_id in (
      select pa.id from public.payment_allocations pa
      where pa.institute_id = i.institute_id and pa.installment_id = i.id
    )
    and r.status = 'Completed'
) r on true;

create view public.student_receipt_balances
with (security_invoker = true)
as
with completed_refunds as (
  select r.institute_id, r.payment_id, sum(r.amount)::numeric(12,2) as completed_refunds
  from public.refunds r
  where r.status = 'Completed'
  group by r.institute_id, r.payment_id
)
select
  p.institute_id,
  p.branch_id,
  p.student_id,
  count(*)::bigint as receipt_count,
  sum(p.amount)::numeric(14,2) as receipt_total,
  sum(coalesce(r.completed_refunds, 0))::numeric(14,2) as completed_refund_total,
  greatest(0::numeric, sum(p.amount) - sum(coalesce(r.completed_refunds, 0)))::numeric(14,2) as net_receipts
from public.payments p
left join completed_refunds r
  on r.institute_id = p.institute_id and r.payment_id = p.id
where p.status in ('Paid', 'Partially Refunded', 'Refunded')
group by p.institute_id, p.branch_id, p.student_id;
revoke all on public.student_receipt_balances from public, anon;
grant select on public.student_receipt_balances to authenticated;
comment on view public.student_receipt_balances is
  'Aggregates actual fee and advance receipt rows once, subtracting only completed refunds; payment allocations are not receipts.';

create or replace function public.save_student_record(
  p_institute_id text,
  p_branch_id text,
  p_student_id text,
  p_student jsonb,
  p_installments jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.students%rowtype;
  v_admission_installment public.student_installments%rowtype;
  v_is_update boolean := false;
  v_name text;
  v_gender text;
  v_parent_name text;
  v_parent_email text;
  v_parent_mobile text;
  v_whatsapp text;
  v_course text;
  v_class_name text;
  v_admission_date date;
  v_admission_fee numeric(12,2);
  v_total_fee numeric(12,2);
  v_legacy_data jsonb;
  v_schedule_total numeric(14,2) := 0;
  v_item jsonb;
  v_installment_id text;
  v_admission_installment_id text;
  v_installment_amount numeric(12,2);
  v_installment_due_date date;
  v_installment_legacy jsonb;
  v_sequence integer;
  v_paid numeric(12,2);
  v_max_sequence integer;
  v_offset integer;
  v_item_count integer;
begin
  if v_actor_id is null
     or auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized institute administrator access is required.' using errcode = '42501';
  end if;
  if p_student_id is null or length(btrim(p_student_id)) not between 1 and 100
     or jsonb_typeof(p_student) is distinct from 'object'
     or jsonb_typeof(p_installments) is distinct from 'array'
     or jsonb_array_length(p_installments) > 120
     or octet_length(p_student::text) > 65536
     or octet_length(p_installments::text) > 65536 then
    raise exception 'Student details or installment schedule are invalid.' using errcode = '22023';
  end if;
  if p_student ? 'legacyData' and jsonb_typeof(p_student->'legacyData') is distinct from 'object' then
    raise exception 'Student legacy data must be an object.' using errcode = '22023';
  end if;

  v_name := nullif(btrim(p_student->>'name'), '');
  v_gender := coalesce(nullif(p_student->>'gender', ''), 'Other');
  v_parent_name := nullif(btrim(p_student->>'parentName'), '');
  v_parent_email := nullif(btrim(p_student->>'parentEmail'), '');
  v_parent_mobile := nullif(btrim(p_student->>'parentMobile'), '');
  v_whatsapp := nullif(btrim(p_student->>'whatsapp'), '');
  v_course := nullif(btrim(p_student->>'course'), '');
  v_class_name := nullif(btrim(p_student->>'className'), '');
  v_admission_date := nullif(p_student->>'admissionDate', '')::date;
  v_admission_fee := coalesce(nullif(p_student->>'admissionFee', '')::numeric, 0);
  v_total_fee := nullif(p_student->>'totalFee', '')::numeric;
  v_legacy_data := coalesce(p_student->'legacyData', '{}'::jsonb);

  if v_name is null or length(v_name) > 100
     or v_gender not in ('Male', 'Female', 'Other')
     or v_parent_name is null or length(v_parent_name) > 100
     or (v_parent_email is not null and (length(v_parent_email) > 254 or v_parent_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
     or (v_parent_mobile is not null and v_parent_mobile !~ '^[0-9]{10}$')
     or (v_whatsapp is not null and v_whatsapp !~ '^[0-9]{10}$')
     or v_course is null or length(v_course) > 200
     or (v_class_name is not null and length(v_class_name) > 100)
     or v_total_fee is null or v_total_fee <= 0 or v_total_fee <> round(v_total_fee, 2)
     or v_admission_fee < 0 or v_admission_fee > v_total_fee or v_admission_fee <> round(v_admission_fee, 2)
     or jsonb_typeof(v_legacy_data) is distinct from 'object' then
    raise exception 'Student details or fee amounts are invalid.' using errcode = '22023';
  end if;

  select count(*) into v_item_count from jsonb_array_elements(p_installments);
  if exists (
    select 1
    from jsonb_array_elements(p_installments) as x(value)
    where jsonb_typeof(x.value) is distinct from 'object'
       or nullif(btrim(x.value->>'id'), '') is null
       or length(btrim(x.value->>'id')) > 100
       or nullif(x.value->>'amount', '') is null
       or (x.value->>'amount')::numeric < 0
       or (x.value->>'amount')::numeric <> round((x.value->>'amount')::numeric, 2)
       or (nullif(x.value->>'dueDate', '') is not null and (x.value->>'dueDate')::date is null)
       or (x.value ? 'legacyData' and jsonb_typeof(x.value->'legacyData') is distinct from 'object')
  ) then
    raise exception 'An installment has invalid details.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_installments) as x(value)
    group by x.value->>'id' having count(*) > 1
  ) then
    raise exception 'Installment IDs must be unique.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_installments)
  loop
    v_schedule_total := v_schedule_total + (v_item->>'amount')::numeric;
  end loop;
  if v_schedule_total <> (v_total_fee - v_admission_fee) then
    raise exception 'Installments must equal the remaining fee after the admission fee.' using errcode = '23514';
  end if;

  select * into v_existing
  from public.students
  where id = p_student_id and institute_id = p_institute_id
  for update;
  v_is_update := found;

  if v_is_update then
    if v_existing.archived_at is not null then
      raise exception 'Archived students cannot be edited.' using errcode = '23514';
    end if;
    if not bizbook_private.can_access_branch(p_institute_id, v_existing.branch_id) then
      raise exception 'Student access is not allowed.' using errcode = '42501';
    end if;
    if v_existing.branch_id is distinct from p_branch_id and exists (
      select 1 from public.payments p where p.institute_id = p_institute_id and p.student_id = p_student_id
    ) then
      raise exception 'A student with payment history cannot be moved to another branch.' using errcode = '23514';
    end if;
    update public.students
      set branch_id = p_branch_id,
          name = v_name,
          gender = v_gender,
          parent_name = v_parent_name,
          parent_email = v_parent_email,
          parent_email_opt_in = coalesce((p_student->>'parentEmailOptIn')::boolean, false),
          whatsapp_opt_in = coalesce((p_student->>'whatsappOptIn')::boolean, false),
          parent_mobile = v_parent_mobile,
          whatsapp = v_whatsapp,
          course = v_course,
          class_name = v_class_name,
          admission_date = v_admission_date,
          admission_fee = v_admission_fee,
          total_fee = v_total_fee,
          legacy_data = v_existing.legacy_data || v_legacy_data
    where id = p_student_id and institute_id = p_institute_id;
  else
    insert into public.students (
      id, institute_id, branch_id, name, gender, parent_name, parent_email,
      parent_email_opt_in, whatsapp_opt_in, parent_mobile, whatsapp, course,
      class_name, admission_date, admission_fee, total_fee, legacy_data, created_by
    ) values (
      p_student_id, p_institute_id, p_branch_id, v_name, v_gender, v_parent_name, v_parent_email,
      coalesce((p_student->>'parentEmailOptIn')::boolean, false),
      coalesce((p_student->>'whatsappOptIn')::boolean, false), v_parent_mobile, v_whatsapp,
      v_course, v_class_name, v_admission_date, v_admission_fee, v_total_fee, v_legacy_data, v_actor_id
    );
  end if;

  -- Refuse to remove any installment that has retained net payment history.
  for v_item in
    select to_jsonb(i)
    from public.student_installments i
    where i.institute_id = p_institute_id and i.student_id = p_student_id
      and i.legacy_data->>'kind' is distinct from 'AdmissionFee'
    for update
  loop
    v_installment_id := v_item->>'id';
    if not exists (
      select 1 from jsonb_array_elements(p_installments) as x(value)
      where x.value->>'id' = v_installment_id
    ) then
      select greatest(0::numeric,
        coalesce((select sum(pa.amount)
          from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
          where pa.institute_id = p_institute_id and pa.installment_id = v_installment_id
            and p.status in ('Paid', 'Partially Refunded', 'Refunded')), 0)
        - coalesce((select sum(ra.amount)
          from public.refund_allocations ra
          join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
          where ra.institute_id = p_institute_id and ra.payment_allocation_id in (
            select pa.id from public.payment_allocations pa
            where pa.institute_id = p_institute_id and pa.installment_id = v_installment_id
          ) and r.status = 'Completed'), 0)
      ) into v_paid;
      if v_paid > 0 then
        raise exception 'An installment with payment history cannot be removed.' using errcode = '23514';
      end if;
    end if;
  end loop;

  select coalesce(max(sequence_number), 0) into v_max_sequence
  from public.student_installments
  where institute_id = p_institute_id and student_id = p_student_id;
  v_offset := v_max_sequence + 200;
  update public.student_installments
  set sequence_number = sequence_number + v_offset
  where institute_id = p_institute_id and student_id = p_student_id;

  update public.student_installments i
  set status = 'Cancelled'
  where i.institute_id = p_institute_id and i.student_id = p_student_id
    and i.legacy_data->>'kind' is distinct from 'AdmissionFee'
    and not exists (
      select 1 from jsonb_array_elements(p_installments) as x(value)
      where x.value->>'id' = i.id
    );

  for v_item, v_sequence in
    select value, ordinal::integer
    from jsonb_array_elements(p_installments) with ordinality as x(value, ordinal)
  loop
    v_installment_id := btrim(v_item->>'id');
    v_installment_amount := (v_item->>'amount')::numeric;
    v_installment_due_date := nullif(v_item->>'dueDate', '')::date;
    v_installment_legacy := coalesce(v_item->'legacyData', '{}'::jsonb);

    if exists (
      select 1 from public.student_installments i
      where i.id = v_installment_id
        and (i.institute_id <> p_institute_id or i.student_id <> p_student_id)
    ) then
      raise exception 'An installment ID belongs to another student.' using errcode = '23503';
    end if;

    select greatest(0::numeric,
      coalesce((select sum(pa.amount)
        from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
        where pa.institute_id = p_institute_id and pa.installment_id = v_installment_id
          and p.status in ('Paid', 'Partially Refunded', 'Refunded')), 0)
      - coalesce((select sum(ra.amount)
        from public.refund_allocations ra
        join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
        where ra.institute_id = p_institute_id and ra.payment_allocation_id in (
          select pa.id from public.payment_allocations pa
          where pa.institute_id = p_institute_id and pa.installment_id = v_installment_id
        ) and r.status = 'Completed'), 0)
    ) into v_paid;
    if v_installment_amount < v_paid then
      raise exception 'An installment cannot be reduced below its net paid amount.' using errcode = '23514';
    end if;

    update public.student_installments i
      set branch_id = p_branch_id,
          sequence_number = v_sequence,
          scheduled_amount = v_installment_amount,
          due_date = v_installment_due_date,
          status = case when v_paid >= v_installment_amount and v_installment_amount > 0 then 'Paid'
            when v_paid > 0 then 'Partially Paid' else 'Pending' end,
          legacy_data = i.legacy_data || v_installment_legacy
    where i.id = v_installment_id and i.institute_id = p_institute_id and i.student_id = p_student_id;

    if not found then
      insert into public.student_installments (
        id, institute_id, branch_id, student_id, sequence_number,
        scheduled_amount, due_date, status, legacy_data, created_by
      ) values (
        v_installment_id, p_institute_id, p_branch_id, p_student_id, v_sequence,
        v_installment_amount, v_installment_due_date,
        case when v_paid >= v_installment_amount and v_installment_amount > 0 then 'Paid' else 'Pending' end,
        v_installment_legacy, v_actor_id
      );
    end if;
  end loop;

  select * into v_admission_installment
  from public.student_installments i
  where i.institute_id = p_institute_id and i.student_id = p_student_id
    and i.legacy_data->>'kind' = 'AdmissionFee'
  for update;
  if found then
    v_admission_installment_id := v_admission_installment.id;
    select greatest(0::numeric,
      coalesce((select sum(pa.amount)
        from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
        where pa.institute_id = p_institute_id and pa.installment_id = v_admission_installment_id
          and p.status in ('Paid', 'Partially Refunded', 'Refunded')), 0)
      - coalesce((select sum(ra.amount)
        from public.refund_allocations ra
        join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
        where ra.institute_id = p_institute_id and ra.payment_allocation_id in (
          select pa.id from public.payment_allocations pa
          where pa.institute_id = p_institute_id and pa.installment_id = v_admission_installment_id
        ) and r.status = 'Completed'), 0)
    ) into v_paid;
    if v_admission_fee < v_paid then
      raise exception 'Admission fee cannot be reduced below its net paid amount.' using errcode = '23514';
    end if;
    if v_admission_fee > 0 then
      update public.student_installments
      set branch_id = p_branch_id,
          sequence_number = 0,
          scheduled_amount = v_admission_fee,
          due_date = v_admission_date,
          status = case when v_paid >= v_admission_fee then 'Paid'
            when v_paid > 0 then 'Partially Paid' else 'Pending' end,
          legacy_data = legacy_data || '{"kind":"AdmissionFee"}'::jsonb
      where id = v_admission_installment_id and institute_id = p_institute_id;
    else
      update public.student_installments
      set sequence_number = 0, status = 'Cancelled'
      where id = v_admission_installment_id and institute_id = p_institute_id;
    end if;
  elsif v_admission_fee > 0 then
    v_admission_installment_id := p_student_id || ':admission-fee';
    insert into public.student_installments (
      id, institute_id, branch_id, student_id, sequence_number,
      scheduled_amount, due_date, status, legacy_data, created_by
    ) values (
      v_admission_installment_id, p_institute_id, p_branch_id, p_student_id, 0,
      v_admission_fee, v_admission_date, 'Pending', '{"kind":"AdmissionFee"}'::jsonb, v_actor_id
    );
  end if;

  with numbered_cancelled as (
    select id, row_number() over (order by sequence_number, id)::integer as cancelled_sequence
    from public.student_installments
    where institute_id = p_institute_id and student_id = p_student_id and status = 'Cancelled'
      and legacy_data->>'kind' is distinct from 'AdmissionFee'
  )
  update public.student_installments i
  set sequence_number = v_item_count + c.cancelled_sequence
  from numbered_cancelled c
  where i.id = c.id;

  return p_student_id;
end;
$$;

create or replace function public.archive_student_record(p_institute_id text, p_student_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id text;
begin
  select s.branch_id into v_branch_id
  from public.students s
  where s.id = p_student_id and s.institute_id = p_institute_id and s.archived_at is null
  for update;
  if not found or auth.uid() is null
     or auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, v_branch_id) then
    raise exception 'Authorized institute administrator access is required.' using errcode = '42501';
  end if;
  update public.students
  set archived_at = now()
  where id = p_student_id and institute_id = p_institute_id and archived_at is null;
end;
$$;

revoke all on function public.save_student_record(text, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.archive_student_record(text, text) from public, anon;
grant execute on function public.save_student_record(text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.archive_student_record(text, text) to authenticated;

comment on function public.save_student_record(text, text, text, jsonb, jsonb) is
  'Atomically saves one tenant-scoped student and fee schedule while preserving unknown legacy fields and protecting paid installments.';
comment on function public.archive_student_record(text, text) is
  'Soft archives a student without deleting fee, receipt, or audit history.';
