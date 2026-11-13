-- Institute support requests and audited Platform Admin responses.
-- This migration is additive; it does not import, rewrite, or remove business rows.

create table public.platform_support_tickets (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  category text not null check (category in ('account', 'billing', 'payments', 'data', 'other')),
  subject text not null check (length(btrim(subject)) between 5 and 120),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (created_by, idempotency_key),
  unique (id, institute_id),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index platform_support_tickets_institute_recent_idx
  on public.platform_support_tickets (institute_id, updated_at desc);
create index platform_support_tickets_status_recent_idx
  on public.platform_support_tickets (status, updated_at desc);

create table public.platform_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  institute_id text not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_kind text not null check (author_kind in ('institute', 'platform')),
  idempotency_key uuid not null,
  body text not null check (
    length(btrim(body)) between 1 and 4000 and octet_length(body) <= 12000
  ),
  created_at timestamptz not null default now(),
  foreign key (ticket_id, institute_id)
    references public.platform_support_tickets(id, institute_id) on delete restrict,
  unique (ticket_id, idempotency_key)
);

create index platform_support_messages_ticket_time_idx
  on public.platform_support_messages (ticket_id, created_at, id);

alter table public.platform_support_tickets enable row level security;
alter table public.platform_support_messages enable row level security;
create policy platform_support_tickets_read_authorized
  on public.platform_support_tickets for select to authenticated
  using (
    public.is_platform_administrator()
    or (
      bizbook_private.has_institute_access(institute_id)
      and (
        created_by = (select auth.uid())
        or bizbook_private.can_manage_institute(institute_id)
      )
    )
  );
create policy platform_support_messages_read_authorized
  on public.platform_support_messages for select to authenticated
  using (
    public.is_platform_administrator()
    or exists (
      select 1 from public.platform_support_tickets t
      where t.id = platform_support_messages.ticket_id
        and t.institute_id = platform_support_messages.institute_id
        and bizbook_private.has_institute_access(t.institute_id)
        and (
          t.created_by = (select auth.uid())
          or bizbook_private.can_manage_institute(t.institute_id)
        )
    )
  );
revoke all on public.platform_support_tickets, public.platform_support_messages
  from public, anon, authenticated;
grant select on public.platform_support_tickets, public.platform_support_messages to authenticated;
grant all on public.platform_support_tickets, public.platform_support_messages to service_role;

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
        and t.created_at > now() - interval '1 day') >= 10 then
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

create or replace function public.list_my_platform_support_tickets(
  p_institute_id text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count bigint;
begin
  if auth.role() is distinct from 'authenticated' or v_user is null
     or not bizbook_private.has_institute_access(p_institute_id) then
    raise exception using errcode = '42501', message = 'Active institute membership is required';
  end if;
  if p_limit not between 1 and 100 or p_offset not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'Pagination values are invalid';
  end if;
  select count(*) into v_count from public.platform_support_tickets t
    where t.institute_id = p_institute_id
      and (t.created_by = v_user or bizbook_private.can_manage_institute(p_institute_id));
  return jsonb_build_object(
    'total', v_count,
    'tickets', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.updated_at desc)
      from (
        select t.id, t.institute_id, t.created_by, t.category, t.subject, t.status,
               t.priority, t.created_at, t.updated_at, t.resolved_at, t.closed_at,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', m.id, 'author_user_id', m.author_user_id,
                   'author_kind', m.author_kind, 'body', m.body, 'created_at', m.created_at
                 ) order by m.created_at, m.id)
                 from (
                   select m0.id, m0.author_user_id, m0.author_kind, m0.body, m0.created_at
                   from public.platform_support_messages m0
                   where m0.ticket_id = t.id and m0.institute_id = t.institute_id
                   order by m0.created_at desc, m0.id desc limit 100
                 ) m
               ), '[]'::jsonb) as messages
        from public.platform_support_tickets t
        where t.institute_id = p_institute_id
          and (t.created_by = v_user or bizbook_private.can_manage_institute(p_institute_id))
        order by t.updated_at desc, t.id
        limit p_limit offset p_offset
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_platform_support_tickets(
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_platform_administrator() then
    raise exception using errcode = '42501', message = 'Platform administrator access is required';
  end if;
  if (p_status is not null and p_status not in ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'))
     or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'Support filters are invalid';
  end if;
  select count(*) into v_count from public.platform_support_tickets t
    where p_status is null or t.status = p_status;
  return jsonb_build_object(
    'total', v_count,
    'tickets', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.updated_at desc)
      from (
        select t.id, t.institute_id, i.business_name, t.created_by, t.category, t.subject,
               t.status, t.priority, t.created_at, t.updated_at, t.resolved_at, t.closed_at,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', m.id, 'author_user_id', m.author_user_id,
                   'author_kind', m.author_kind, 'body', m.body, 'created_at', m.created_at
                 ) order by m.created_at, m.id)
                 from (
                   select m0.id, m0.author_user_id, m0.author_kind, m0.body, m0.created_at
                   from public.platform_support_messages m0
                   where m0.ticket_id = t.id and m0.institute_id = t.institute_id
                   order by m0.created_at desc, m0.id desc limit 100
                 ) m
               ), '[]'::jsonb) as messages
        from public.platform_support_tickets t
        join public.coaching_institutes i on i.id = t.institute_id
        where p_status is null or t.status = p_status
        order by t.updated_at desc, t.id
        limit p_limit offset p_offset
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.reply_platform_support_ticket(
  p_ticket_id uuid,
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
  v_ticket public.platform_support_tickets%rowtype;
  v_is_platform boolean;
  v_message_id uuid;
  v_existing public.platform_support_messages%rowtype;
  v_author_kind text;
begin
  if auth.role() is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_idempotency_key is null or p_message is null
     or length(btrim(p_message)) not between 1 and 4000 or octet_length(p_message) > 12000 then
    raise exception using errcode = '22023', message = 'Support reply is invalid';
  end if;
  select * into v_ticket from public.platform_support_tickets t
    where t.id = p_ticket_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Support request was not found'; end if;
  v_is_platform := public.is_platform_administrator();
  if not v_is_platform and (
      not bizbook_private.has_institute_access(v_ticket.institute_id)
      or (v_ticket.created_by <> v_user and not bizbook_private.can_manage_institute(v_ticket.institute_id))
  ) then
    raise exception using errcode = '42501', message = 'Support request access is not authorized';
  end if;
  if v_ticket.status = 'closed' then
    raise exception using errcode = '23514', message = 'Closed support requests cannot receive replies';
  end if;
  v_author_kind := case when v_is_platform then 'platform' else 'institute' end;
  insert into public.platform_support_messages(
    ticket_id, institute_id, author_user_id, author_kind, idempotency_key, body
  ) values (
    v_ticket.id, v_ticket.institute_id, v_user, v_author_kind, p_idempotency_key, btrim(p_message)
  ) on conflict (ticket_id, idempotency_key) do nothing returning id into v_message_id;

  if v_message_id is null then
    select * into v_existing from public.platform_support_messages m
      where m.ticket_id = v_ticket.id and m.idempotency_key = p_idempotency_key;
    if v_existing.author_user_id <> v_user or v_existing.body <> btrim(p_message)
       or v_existing.author_kind <> v_author_kind then
      raise exception using errcode = '23505', message = 'Support reply key was reused with different data';
    end if;
    return v_existing.id;
  end if;

  update public.platform_support_tickets t set
    status = case when v_is_platform then 'waiting_on_customer' else 'open' end,
    updated_at = now(),
    resolved_at = null
  where t.id = v_ticket.id;

  if v_is_platform then
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_user, 'support_ticket_replied', 'support_ticket', v_ticket.id::text,
            jsonb_build_object('institute_id', v_ticket.institute_id, 'message_id', v_message_id));
  end if;
  return v_message_id;
end;
$$;

create or replace function public.set_platform_support_ticket_state(
  p_ticket_id uuid,
  p_status text,
  p_priority text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.platform_support_tickets%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or v_user is null
     or not public.is_platform_administrator() then
    raise exception using errcode = '42501', message = 'Platform administrator access is required';
  end if;
  if p_status is null or p_status not in ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed')
     or p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception using errcode = '22023', message = 'Support status or priority is invalid';
  end if;
  select * into v_ticket from public.platform_support_tickets t
    where t.id = p_ticket_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Support request was not found'; end if;
  update public.platform_support_tickets t set
    status = p_status,
    priority = p_priority,
    resolved_at = case when p_status = 'resolved' then coalesce(t.resolved_at, now()) else null end,
    closed_at = case when p_status = 'closed' then coalesce(t.closed_at, now()) else null end,
    updated_at = now()
  where t.id = p_ticket_id;
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user, 'support_ticket_state_changed', 'support_ticket', p_ticket_id::text,
          jsonb_build_object('institute_id', v_ticket.institute_id,
                             'old_status', v_ticket.status, 'new_status', p_status,
                             'old_priority', v_ticket.priority, 'new_priority', p_priority));
  return jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status, 'priority', p_priority);
end;
$$;

revoke all on function public.create_platform_support_ticket(text, text, text, text, uuid) from public, anon;
revoke all on function public.list_my_platform_support_tickets(text, integer, integer) from public, anon;
revoke all on function public.list_platform_support_tickets(text, integer, integer) from public, anon;
revoke all on function public.reply_platform_support_ticket(uuid, text, uuid) from public, anon;
revoke all on function public.set_platform_support_ticket_state(uuid, text, text) from public, anon;
grant execute on function public.create_platform_support_ticket(text, text, text, text, uuid) to authenticated;
grant execute on function public.list_my_platform_support_tickets(text, integer, integer) to authenticated;
grant execute on function public.list_platform_support_tickets(text, integer, integer) to authenticated;
grant execute on function public.reply_platform_support_ticket(uuid, text, uuid) to authenticated;
grant execute on function public.set_platform_support_ticket_state(uuid, text, text) to authenticated;
