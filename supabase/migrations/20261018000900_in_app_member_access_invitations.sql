-- Member invitations are accepted explicitly from the invitee's signed-in
-- BizBook account. Creating an account or entering an email never grants access.

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
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_branches text[] := coalesce(p_branch_ids, '{}'::text[]);
  v_valid_branch_count integer;
  v_account_count integer;
  v_existing_user_id uuid;
  v_invitation_id uuid;
begin
  if v_actor_id is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.length(v_email) > 254
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
    raise exception 'Only an institute owner may invite an owner or administrator.' using errcode = '42501';
  end if;
  if v_email = (select pg_catalog.lower(account.email) from auth.users account where account.id = v_actor_id) then
    raise exception 'You cannot invite your own account to this institute.' using errcode = '22023';
  end if;
  if (p_access_scope = 'institute' and cardinality(v_branches) <> 0)
     or (p_access_scope = 'branches' and cardinality(v_branches) = 0) then
    raise exception 'Choose active branches for branch-scoped access.' using errcode = '22023';
  end if;

  if p_access_scope = 'branches' then
    select count(distinct branch.id)::integer into v_valid_branch_count
    from public.branches branch
    where branch.institute_id = p_institute_id
      and branch.is_active and branch.id = any(v_branches);
    if v_valid_branch_count <> cardinality(v_branches) then
      raise exception 'One or more selected branches are inactive or unavailable.' using errcode = '22023';
    end if;
  end if;

  select count(*)::integer, (array_agg(account.id))[1]
  into v_account_count, v_existing_user_id
  from auth.users account
  where pg_catalog.lower(account.email) = v_email
    and account.email_confirmed_at is not null;
  if v_account_count <> 1 then
    raise exception 'The member must first create a BizBook account and verify this email address.' using errcode = '22023';
  end if;
  if v_existing_user_id = v_actor_id then
    raise exception 'You cannot invite your own account to this institute.' using errcode = '22023';
  end if;
  if v_existing_user_id is not null and exists (
    select 1 from public.user_memberships membership
    where membership.institute_id = p_institute_id
      and membership.user_id = v_existing_user_id
  ) then
    raise exception 'This account already has a membership in this institute.' using errcode = '23505';
  end if;

  -- The private helper serializes duplicate email invites and only upserts a
  -- pending invitation. No Auth account is looked up or granted access here.
  v_invitation_id := bizbook_private.put_member_access_invitation(
    p_institute_id, v_email, p_role, p_access_scope, v_branches, v_actor_id, false
  );
  return jsonb_build_object('status', 'invited', 'invitation_id', v_invitation_id);
end;
$$;

create or replace function public.list_my_member_access_invitations()
returns table (
  id uuid,
  institute_id text,
  institute_name text,
  role text,
  access_scope text,
  branch_ids text[],
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your invitations.' using errcode = '42501';
  end if;
  select pg_catalog.lower(account.email) into v_email
  from auth.users account
  where account.id = auth.uid() and account.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Verify your email before viewing invitations.' using errcode = '42501';
  end if;

  update public.member_access_invitations invitation
  set status = 'expired', updated_at = now()
  where pg_catalog.lower(invitation.email) = v_email
    and invitation.status = 'pending'
    and invitation.expires_at <= now();

  return query
  select invitation.id, invitation.institute_id, institute.business_name,
         invitation.role, invitation.access_scope, invitation.branch_ids,
         invitation.expires_at, invitation.created_at
  from public.member_access_invitations invitation
  join public.coaching_institutes institute on institute.id = invitation.institute_id
  where pg_catalog.lower(invitation.email) = v_email
    and invitation.status = 'pending'
    and invitation.expires_at > now()
    and institute.account_status = 'active'
  order by invitation.created_at desc;
end;
$$;

create or replace function public.accept_member_access_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation public.member_access_invitations%rowtype;
  v_institute_name text;
  v_active_branch_count integer;
begin
  if v_user_id is null then
    raise exception 'Sign in before accepting an invitation.' using errcode = '42501';
  end if;
  select pg_catalog.lower(account.email) into v_email
  from auth.users account
  where account.id = v_user_id and account.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Verify the invited email address before accepting.' using errcode = '42501';
  end if;

  select invitation.* into v_invitation
  from public.member_access_invitations invitation
  where invitation.id = p_invitation_id
    and pg_catalog.lower(invitation.email) = v_email
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  for update;
  if not found then
    raise exception 'This invitation is unavailable, expired, or belongs to another email.' using errcode = '42501';
  end if;

  perform 1 from public.coaching_institutes institute
  where institute.id = v_invitation.institute_id
    and institute.account_status = 'active'
  for update;
  if not found then
    raise exception 'This institute is not currently accepting access.' using errcode = '42501';
  end if;
  select institute.business_name into v_institute_name
  from public.coaching_institutes institute where institute.id = v_invitation.institute_id;

  if exists (
    select 1 from public.user_memberships membership
    where membership.institute_id = v_invitation.institute_id
      and membership.user_id = v_user_id
  ) then
    raise exception 'This account already has a membership in this institute.' using errcode = '23505';
  end if;

  if v_invitation.role in ('owner', 'administrator') and not exists (
    select 1 from public.user_memberships owner_membership
    where owner_membership.institute_id = v_invitation.institute_id
      and owner_membership.user_id = v_invitation.created_by
      and owner_membership.role = 'owner'
      and owner_membership.is_active
  ) then
    raise exception 'The owner who created this elevated-role invitation is no longer active. Ask an active owner to invite you again.' using errcode = '42501';
  end if;

  if v_invitation.access_scope = 'branches' then
    select count(distinct branch.id)::integer into v_active_branch_count
    from public.branches branch
    where branch.institute_id = v_invitation.institute_id
      and branch.id = any(v_invitation.branch_ids)
      and branch.is_active;
    if v_active_branch_count <> cardinality(v_invitation.branch_ids) then
      raise exception 'One or more invited branches are no longer active. Ask the owner to update the invitation.' using errcode = '22023';
    end if;
  end if;

  insert into public.user_memberships (
    institute_id, user_id, role, access_scope, is_active, created_by
  ) values (
    v_invitation.institute_id, v_user_id, v_invitation.role,
    v_invitation.access_scope, true, v_invitation.created_by
  );

  if v_invitation.access_scope = 'branches' then
    insert into public.membership_branch_access (institute_id, user_id, branch_id, granted_by)
    select v_invitation.institute_id, v_user_id, branch_id, v_invitation.created_by
    from unnest(v_invitation.branch_ids) as branch_id
    on conflict (institute_id, user_id, branch_id) do nothing;
  end if;

  update public.member_access_invitations
  set status = 'accepted', accepted_user_id = v_user_id,
      accepted_at = now(), updated_at = now()
  where id = v_invitation.id;

  return jsonb_build_object(
    'status', 'accepted', 'institute_id', v_invitation.institute_id,
    'institute_name', v_institute_name, 'role', v_invitation.role
  );
end;
$$;

revoke all on function public.create_member_access_invitation(text, text, text, text, text[])
  from public, anon;
grant execute on function public.create_member_access_invitation(text, text, text, text, text[])
  to authenticated;
revoke all on function public.list_my_member_access_invitations() from public, anon;
grant execute on function public.list_my_member_access_invitations() to authenticated;
revoke all on function public.accept_member_access_invitation(uuid) from public, anon;
grant execute on function public.accept_member_access_invitation(uuid) to authenticated;

-- Re-enable only the institute-scoped actions needed by the member screens.
-- Direct UUID/email membership grants and bulk auto-accept stay disabled.
revoke all on function public.list_institute_members(text) from public, anon;
grant execute on function public.list_institute_members(text) to authenticated;
revoke all on function public.list_member_access_invitations(text) from public, anon;
grant execute on function public.list_member_access_invitations(text) to authenticated;
revoke all on function public.revoke_member_access_invitation(uuid) from public, anon;
grant execute on function public.revoke_member_access_invitation(uuid) to authenticated;
revoke all on function public.accept_pending_member_access_invitations() from public, anon, authenticated;
revoke all on function public.grant_institute_membership(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.grant_institute_membership_by_email(text, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.remove_institute_member(text, uuid) from public, anon;
grant execute on function public.remove_institute_member(text, uuid) to authenticated;

comment on function public.create_member_access_invitation(text, text, text, text, text[]) is
  'Creates an in-app email-bound invitation only; membership is granted only by accept_member_access_invitation for the authenticated verified-email user.';
comment on function public.accept_member_access_invitation(uuid) is
  'Accepts exactly one email-matched pending invitation and creates only that institute membership.';
