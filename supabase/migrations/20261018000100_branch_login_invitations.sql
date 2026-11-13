-- Branch login emails are individual staff addresses, not shared branch accounts.
-- An unregistered address receives access only after the user verifies their own Auth OTP.

alter table public.branches
  add column branch_login_email text;

create table public.member_access_invitations (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  email text not null check (length(email) between 3 and 254),
  role text not null check (role in ('owner', 'administrator', 'accountant', 'staff')),
  access_scope text not null check (access_scope in ('institute', 'branches')),
  branch_ids text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_by uuid references auth.users(id) on delete set null,
  accepted_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((access_scope = 'institute' and cardinality(branch_ids) = 0)
      or (access_scope = 'branches' and cardinality(branch_ids) > 0))
);

create unique index member_access_invitations_pending_email_uq
  on public.member_access_invitations (institute_id, lower(email))
  where status = 'pending';
create index member_access_invitations_pending_expiry_idx
  on public.member_access_invitations (expires_at)
  where status = 'pending';

alter table public.member_access_invitations enable row level security;
revoke all on public.member_access_invitations from public, anon, authenticated;

create trigger member_access_invitations_audit
  after insert or update or delete on public.member_access_invitations
  for each row execute function bizbook_private.audit_row_change();

grant insert (branch_login_email) on public.branches to authenticated;
grant update (branch_login_email) on public.branches to authenticated;

create or replace function bizbook_private.put_member_access_invitation(
  p_institute_id text,
  p_email text,
  p_role text,
  p_access_scope text,
  p_branch_ids text[],
  p_created_by uuid,
  p_merge_branches boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_scope text;
  v_existing_branch_ids text[];
  v_branch_ids text[] := coalesce(p_branch_ids, '{}'::text[]);
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_institute_id || ':' || v_email, 0)
  );

  select invitation.id, invitation.access_scope, invitation.branch_ids
  into v_id, v_scope, v_existing_branch_ids
  from public.member_access_invitations invitation
  where invitation.institute_id = p_institute_id
    and lower(invitation.email) = v_email
    and invitation.status = 'pending'
  for update;

  if found then
    if p_merge_branches then
      if v_scope = 'branches' then
        update public.member_access_invitations invitation
        set branch_ids = (
              select array_agg(distinct branch_id order by branch_id)
              from unnest(v_existing_branch_ids || v_branch_ids) as branch_id
            ),
            expires_at = now() + interval '30 days',
            updated_at = now()
        where invitation.id = v_id;
      end if;
      return v_id;
    end if;

    update public.member_access_invitations invitation
    set email = v_email,
        role = p_role,
        access_scope = p_access_scope,
        branch_ids = v_branch_ids,
        expires_at = now() + interval '30 days',
        created_by = p_created_by,
        updated_at = now()
    where invitation.id = v_id;
    return v_id;
  end if;

  insert into public.member_access_invitations (
    institute_id, email, role, access_scope, branch_ids, created_by
  ) values (
    p_institute_id, v_email, p_role, p_access_scope, v_branch_ids, p_created_by
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function bizbook_private.put_member_access_invitation(text, text, text, text, text[], uuid, boolean)
  from public, anon, authenticated;

create or replace function public.create_member_access_invitation(
  p_institute_id text,
  p_email text,
  p_role text,
  p_access_scope text,
  p_branch_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_branch_ids text[] := coalesce(p_branch_ids, '{}'::text[]);
  v_valid_branch_count integer;
  v_user_id uuid;
  v_match_count integer;
  v_invitation_id uuid;
begin
  if v_actor_id is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_role is null or p_role not in ('owner', 'administrator', 'accountant', 'staff')
     or p_access_scope is null or p_access_scope not in ('institute', 'branches') then
    raise exception 'Member email, role, or access scope is invalid.' using errcode = '22023';
  end if;

  perform 1 from public.coaching_institutes institute
  where institute.id = p_institute_id for update;
  if not found or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;

  select membership.role into v_actor_role
  from public.user_memberships membership
  where membership.institute_id = p_institute_id
    and membership.user_id = v_actor_id and membership.is_active;
  if p_role in ('owner', 'administrator') and v_actor_role <> 'owner' then
    raise exception 'Only an institute owner may grant owner or administrator roles.' using errcode = '42501';
  end if;
  if (p_access_scope = 'institute' and cardinality(v_branch_ids) <> 0)
     or (p_access_scope = 'branches' and cardinality(v_branch_ids) = 0) then
    raise exception 'Choose active branches for branch-scoped access.' using errcode = '22023';
  end if;

  if p_access_scope = 'branches' then
    select count(distinct branch.id)::integer into v_valid_branch_count
    from public.branches branch
    where branch.institute_id = p_institute_id
      and branch.is_active and branch.id = any(v_branch_ids);
    if v_valid_branch_count <> cardinality(v_branch_ids) then
      raise exception 'One or more selected branches are inactive or unavailable.' using errcode = '22023';
    end if;
  end if;

  select count(*)::integer, (array_agg(account.id))[1]
  into v_match_count, v_user_id
  from auth.users account
  where lower(account.email) = v_email and account.email_confirmed_at is not null;
  if v_match_count = 1 then
    perform public.grant_institute_membership_by_email(
      p_institute_id, v_email, p_role, p_access_scope, v_branch_ids
    );
    return jsonb_build_object('status', 'granted');
  elsif v_match_count > 1 then
    raise exception 'This email matches more than one account; ask support to resolve it.' using errcode = '22023';
  end if;

  v_invitation_id := bizbook_private.put_member_access_invitation(
    p_institute_id, v_email, p_role, p_access_scope, v_branch_ids, v_actor_id, false
  );
  return jsonb_build_object('status', 'invited', 'invitation_id', v_invitation_id);
end;
$$;

revoke all on function public.create_member_access_invitation(text, text, text, text, text[])
  from public, anon;
grant execute on function public.create_member_access_invitation(text, text, text, text, text[])
  to authenticated;

create or replace function public.list_member_access_invitations(p_institute_id text)
returns table (
  id uuid,
  email text,
  role text,
  access_scope text,
  branch_ids text[],
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  return query
  select invitation.id, invitation.email, invitation.role,
         invitation.access_scope, invitation.branch_ids, invitation.expires_at
  from public.member_access_invitations invitation
  where invitation.institute_id = p_institute_id
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  order by invitation.created_at desc;
end;
$$;

revoke all on function public.list_member_access_invitations(text) from public, anon;
grant execute on function public.list_member_access_invitations(text) to authenticated;

create or replace function public.revoke_member_access_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute_id text;
  v_invitation_role text;
  v_actor_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage invitations.' using errcode = '42501';
  end if;
  select invitation.institute_id, invitation.role
  into v_institute_id, v_invitation_role
  from public.member_access_invitations invitation
  where invitation.id = p_invitation_id and invitation.status = 'pending'
  for update;
  if not found or not bizbook_private.can_manage_institute(v_institute_id) then
    raise exception 'The invitation is unavailable or access is denied.' using errcode = '42501';
  end if;
  select membership.role into v_actor_role
  from public.user_memberships membership
  where membership.institute_id = v_institute_id
    and membership.user_id = auth.uid() and membership.is_active;
  if v_invitation_role in ('owner', 'administrator') and v_actor_role <> 'owner' then
    raise exception 'Only an institute owner may revoke this elevated-role invitation.' using errcode = '42501';
  end if;
  update public.member_access_invitations
  set status = 'revoked', updated_at = now()
  where id = p_invitation_id;
end;
$$;

revoke all on function public.revoke_member_access_invitation(uuid) from public, anon;
grant execute on function public.revoke_member_access_invitation(uuid) to authenticated;

create or replace function public.accept_pending_member_access_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation record;
  v_active_branch_ids text[];
  v_existing_role text;
  v_existing_scope text;
  v_existing_active boolean;
  v_accepted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sign in before accepting a membership invitation.' using errcode = '42501';
  end if;
  select lower(account.email) into v_email
  from auth.users account
  where account.id = v_user_id and account.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Verify this email address before accepting a membership invitation.' using errcode = '42501';
  end if;

  update public.member_access_invitations invitation
  set status = 'expired', updated_at = now()
  where lower(invitation.email) = v_email
    and invitation.status = 'pending'
    and invitation.expires_at <= now();

  for v_invitation in
    select invitation.*
    from public.member_access_invitations invitation
    where lower(invitation.email) = v_email
      and invitation.status = 'pending'
      and invitation.expires_at > now()
    order by invitation.created_at
    for update skip locked
  loop
    v_active_branch_ids := '{}'::text[];
    if v_invitation.access_scope = 'branches' then
      select coalesce(array_agg(branch.id order by branch.id), '{}'::text[])
      into v_active_branch_ids
      from public.branches branch
      where branch.institute_id = v_invitation.institute_id
        and branch.is_active
        and branch.id = any(v_invitation.branch_ids);
      if cardinality(v_active_branch_ids) = 0 then
        continue;
      end if;
    end if;

    select membership.role, membership.access_scope, membership.is_active
    into v_existing_role, v_existing_scope, v_existing_active
    from public.user_memberships membership
    where membership.institute_id = v_invitation.institute_id
      and membership.user_id = v_user_id
    for update;

    if found and v_existing_active
       and ((v_existing_role = 'owner' and v_invitation.role <> 'owner')
         or (v_existing_scope = 'institute' and v_invitation.access_scope = 'branches')) then
      update public.member_access_invitations
      set status = 'accepted', accepted_user_id = v_user_id, accepted_at = now(), updated_at = now()
      where id = v_invitation.id;
      v_accepted_count := v_accepted_count + 1;
      continue;
    end if;

    if found and (v_existing_scope is distinct from v_invitation.access_scope or not v_existing_active) then
      delete from public.membership_branch_access
      where institute_id = v_invitation.institute_id and user_id = v_user_id;
    end if;

    insert into public.user_memberships (
      institute_id, user_id, role, access_scope, is_active, created_by
    ) values (
      v_invitation.institute_id, v_user_id, v_invitation.role,
      v_invitation.access_scope, true, v_invitation.created_by
    )
    on conflict (institute_id, user_id) do update
      set role = excluded.role,
          access_scope = excluded.access_scope,
          is_active = true,
          updated_at = now();

    if v_invitation.access_scope = 'branches' then
      insert into public.membership_branch_access (institute_id, user_id, branch_id, granted_by)
      select v_invitation.institute_id, v_user_id, branch_id, v_invitation.created_by
      from unnest(v_active_branch_ids) as branch_id
      on conflict (institute_id, user_id, branch_id) do update
        set granted_by = excluded.granted_by;
    end if;

    update public.member_access_invitations
    set status = 'accepted', accepted_user_id = v_user_id, accepted_at = now(), updated_at = now()
    where id = v_invitation.id;
    v_accepted_count := v_accepted_count + 1;
  end loop;
  return v_accepted_count;
end;
$$;

revoke all on function public.accept_pending_member_access_invitations() from public, anon;
grant execute on function public.accept_pending_member_access_invitations() to authenticated;

create or replace function bizbook_private.validate_branch_login_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.branch_login_email is distinct from old.branch_login_email then
    new.branch_login_email := lower(btrim(coalesce(new.branch_login_email, '')));
    if auth.uid() is null then
      return new;
    end if;
    if new.branch_login_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or length(new.branch_login_email) > 254 then
      raise exception 'A valid branch login email is required.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger branches_require_login_email
  before insert or update of branch_login_email on public.branches
  for each row execute function bizbook_private.validate_branch_login_email();

create or replace function bizbook_private.sync_branch_login_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_existing_scope text;
  v_existing_active boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  if not bizbook_private.can_manage_institute(new.institute_id) then
    raise exception 'Institute administrator access is required to manage branch login access.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and old.branch_login_email is not distinct from new.branch_login_email
     and old.is_active is not distinct from new.is_active then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and lower(coalesce(old.branch_login_email, '')) <> lower(coalesce(new.branch_login_email, '')) then
    update public.member_access_invitations invitation
    set branch_ids = array_remove(invitation.branch_ids, old.id),
        status = case when cardinality(array_remove(invitation.branch_ids, old.id)) = 0 then 'revoked' else 'pending' end,
        updated_at = now()
    where invitation.institute_id = old.institute_id
      and lower(invitation.email) = lower(old.branch_login_email)
      and invitation.status = 'pending'
      and invitation.access_scope = 'branches'
      and old.id = any(invitation.branch_ids);
  end if;

  if not new.is_active then
    update public.member_access_invitations invitation
    set branch_ids = array_remove(invitation.branch_ids, new.id),
        status = case when cardinality(array_remove(invitation.branch_ids, new.id)) = 0 then 'revoked' else 'pending' end,
        updated_at = now()
    where invitation.institute_id = new.institute_id
      and lower(invitation.email) = lower(new.branch_login_email)
      and invitation.status = 'pending'
      and invitation.access_scope = 'branches'
      and new.id = any(invitation.branch_ids);
    return new;
  end if;

  if new.branch_login_email is null then
    return new;
  end if;

  select account.id into v_user_id
  from auth.users account
  where lower(account.email) = lower(new.branch_login_email)
    and account.email_confirmed_at is not null;

  if v_user_id is not null then
    select membership.access_scope, membership.is_active
    into v_existing_scope, v_existing_active
    from public.user_memberships membership
    where membership.institute_id = new.institute_id
      and membership.user_id = v_user_id;
    if found then
      if v_existing_active and v_existing_scope = 'branches' then
        perform public.set_membership_branch_access(new.institute_id, v_user_id, new.id, true);
      end if;
      return new;
    end if;
    perform public.grant_institute_membership(new.institute_id, v_user_id, 'staff', 'branches');
    perform public.set_membership_branch_access(new.institute_id, v_user_id, new.id, true);
    return new;
  end if;

  perform bizbook_private.put_member_access_invitation(
    new.institute_id, new.branch_login_email, 'staff', 'branches', array[new.id], auth.uid(), true
  );
  return new;
end;
$$;

revoke all on function bizbook_private.sync_branch_login_invitation() from public, anon, authenticated;

create trigger branches_sync_login_invitation
  after insert or update of branch_login_email, is_active on public.branches
  for each row execute function bizbook_private.sync_branch_login_invitation();

comment on column public.branches.branch_login_email is
  'Individual branch access email. It is not a shared branch account; a new user must verify their own email before access is activated.';
comment on table public.member_access_invitations is
  'Private pending institute membership invitations, accepted only by a signed-in Auth user with a confirmed matching email.';
