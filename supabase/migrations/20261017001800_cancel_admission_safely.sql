-- Admission cancellation is an auditable soft close. It never alters fees,
-- installments, receipts, allocations, or refunds.
alter table public.students
  add column if not exists admission_cancelled_at timestamptz,
  add column if not exists admission_cancellation_reason text;

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.students'::regclass
       and conname = 'students_admission_cancellation_consistent'
  ) then
    alter table public.students
      add constraint students_admission_cancellation_consistent
      check (
        (admission_cancelled_at is null and admission_cancellation_reason is null)
        or (admission_cancelled_at is not null and archived_at is not null
            and admission_cancellation_reason is not null
            and length(btrim(admission_cancellation_reason)) between 5 and 500)
      );
  end if;
end;
$constraint$;

create or replace function public.cancel_student_admission(
  p_institute_id text,
  p_student_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_actor_id uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated' or v_actor_id is null then
    raise exception using errcode = '42501', message = 'Authenticated institute administrator access is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'Enter a cancellation reason between 5 and 500 characters';
  end if;

  select s.* into v_student
    from public.students s
   where s.id = p_student_id and s.institute_id = p_institute_id
   for update;
  if not found
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, v_student.branch_id) then
    raise exception using errcode = '42501', message = 'Authorized institute administrator access is required';
  end if;

  if v_student.admission_cancelled_at is not null then
    if v_student.admission_cancellation_reason is distinct from btrim(p_reason) then
      raise exception using errcode = '23505', message = 'Admission was already cancelled with a different reason';
    end if;
    return jsonb_build_object('status', 'already_cancelled', 'student_id', p_student_id,
      'cancelled_at', v_student.admission_cancelled_at);
  end if;
  if v_student.archived_at is not null then
    raise exception using errcode = '22023', message = 'This student is already archived and cannot be cancelled as an active admission';
  end if;

  -- Lock payment orders so a webhook cannot move an unresolved checkout while
  -- cancellation is being decided. Order creation takes FOR SHARE on student.
  perform 1
    from public.payment_orders o
   where o.institute_id = p_institute_id and o.student_id = p_student_id
     and o.order_status in ('Pending', 'Processing', 'Authorized')
   for update;
  if found then
    raise exception using errcode = '55P03', message = 'Reconcile or cancel the pending online payment before cancelling admission';
  end if;

  update public.payment_checkout_links l
     set revoked_at = now()
    from public.payment_orders o
   where l.payment_order_id = o.id and l.institute_id = o.institute_id
     and o.institute_id = p_institute_id and o.student_id = p_student_id
     and l.revoked_at is null;

  update public.students
     set archived_at = now(),
         admission_cancelled_at = now(),
         admission_cancellation_reason = btrim(p_reason)
   where id = p_student_id and institute_id = p_institute_id;

  insert into public.audit_logs (
    institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata
  ) values (
    p_institute_id, v_student.branch_id, 'student_admission', p_student_id,
    'UPDATE', v_actor_id,
    jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason),
      'financial_history_preserved', true, 'refund_issued', false, 'charges_waived', false)
  );

  return jsonb_build_object('status', 'cancelled', 'student_id', p_student_id,
    'cancelled_at', now(), 'financial_history_preserved', true,
    'refund_issued', false, 'charges_waived', false);
end;
$$;

revoke all on function public.cancel_student_admission(text, text, text) from public, anon;
grant execute on function public.cancel_student_admission(text, text, text) to authenticated;
comment on function public.cancel_student_admission(text, text, text) is
  'Soft-cancels an active admission with an audit reason, preserves all financial history, and refuses unresolved online orders.';

-- Serialize both manual and online receipt creation with the student lock used
-- above. Exact marker checks fail closed if the source function has drifted.
do $lock_manual_student$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.record_manual_payment(text,text,text,text,numeric,text,date,text,text,jsonb,text,text)'::regprocedure
  );
  v_marker text := 'and bizbook_private.can_access_branch(s.institute_id, s.branch_id);';
  v_replacement text := 'and bizbook_private.can_access_branch(s.institute_id, s.branch_id)' || E'\n    for share;';
begin
  if (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1 then
    raise exception 'Manual-payment student lookup changed; review admission-cancellation locking patch.';
  end if;
  execute replace(v_definition, v_marker, v_replacement);
end;
$lock_manual_student$;

do $lock_online_student$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.create_online_payment_order_intent(text,text,text,text,text,numeric,text,numeric,text)'::regprocedure
  );
  v_marker text := 'and s.archived_at is null and bizbook_private.can_access_branch(s.institute_id, s.branch_id);';
  v_replacement text := 'and s.archived_at is null and bizbook_private.can_access_branch(s.institute_id, s.branch_id)' || E'\n       for share;';
begin
  if (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1 then
    raise exception 'Online-payment student lookup changed; review admission-cancellation locking patch.';
  end if;
  execute replace(v_definition, v_marker, v_replacement);
end;
$lock_online_student$;

-- Defend parent checkout links even if a cancellation path ever fails to
-- revoke an individual link.
do $guard_parent_checkout$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.resolve_payment_checkout_link(text)'::regprocedure
  );
  v_marker text := 'join public.coaching_institutes i on i.id = o.institute_id and i.account_status = ''active''';
  v_replacement text := v_marker || E'\n    join public.students s on s.id = o.student_id and s.institute_id = o.institute_id and s.archived_at is null';
begin
  if (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1 then
    raise exception 'Parent checkout resolver changed; review admission-cancellation guard.';
  end if;
  execute replace(v_definition, v_marker, v_replacement);
end;
$guard_parent_checkout$;
