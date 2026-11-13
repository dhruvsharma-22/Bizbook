-- Correct the new-ticket limit boundary; applied support migration remains immutable.
create or replace function public.create_platform_support_ticket(
  p_institute_id text,
  p_category text,
  p_subject text,
  p_message text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ticket_id uuid;
  v_existing public.platform_support_tickets%rowtype;
  v_existing_message text;
begin
  if auth.role() is distinct from 'authenticated' or v_user is null
     or not bizbook_private.has_institute_access(p_institute_id) then
    raise exception using errcode = '42501', message = 'Active institute membership is required';
  end if;
  if p_idempotency_key is null
     or p_category is null or p_category not in ('account', 'billing', 'payments', 'data', 'other')
     or p_subject is null or length(btrim(p_subject)) not between 5 and 120
     or p_message is null or length(btrim(p_message)) not between 20 and 4000
     or octet_length(p_message) > 12000 then
    raise exception using errcode = '22023', message = 'Support request fields are invalid';
  end if;

  -- Serialize per-user creates so concurrent requests cannot pass the rate limit.
  -- The idempotent retry path below must run before counting against the limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));

  insert into public.platform_support_tickets(
    institute_id, created_by, idempotency_key, category, subject
  ) values (
    p_institute_id, v_user, p_idempotency_key, p_category, btrim(p_subject)
  ) on conflict (created_by, idempotency_key) do nothing returning id into v_ticket_id;

  if v_ticket_id is null then
    select * into v_existing from public.platform_support_tickets t
      where t.created_by = v_user and t.idempotency_key = p_idempotency_key for update;
    select m.body into v_existing_message from public.platform_support_messages m
      where m.ticket_id = v_existing.id and m.idempotency_key = p_idempotency_key;
    if v_existing.institute_id is distinct from p_institute_id
       or v_existing.category is distinct from p_category
       or v_existing.subject is distinct from btrim(p_subject)
       or v_existing_message is distinct from btrim(p_message) then
      raise exception using errcode = '23505', message = 'Support request idempotency key was reused with different data';
    end if;
    return v_existing.id;
  end if;

  if (select count(*) from public.platform_support_tickets t
      where t.created_by = v_user and t.status not in ('resolved', 'closed')
        and t.created_at > now() - interval '1 day') > 10 then
    raise exception using errcode = '54000', message = 'Too many open support requests';
  end if;

  insert into public.platform_support_messages(
    ticket_id, institute_id, author_user_id, author_kind, idempotency_key, body
  ) values (
    v_ticket_id, p_institute_id, v_user, 'institute', p_idempotency_key, btrim(p_message)
  );
  return v_ticket_id;
end;
$$;
