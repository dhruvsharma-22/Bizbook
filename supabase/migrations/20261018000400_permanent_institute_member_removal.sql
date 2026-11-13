-- Permanently remove a person's membership from one institute.
-- Their Supabase Auth user and memberships in other institutes are untouched.
create or replace function public.remove_institute_member(
  p_institute_id text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_target_active boolean;
  v_target_email text;
  v_active_owner_count integer;
begin
  if v_actor_id is null or p_institute_id is null or p_user_id is null then
    raise exception 'Sign in and select a valid institute member.' using errcode = '42501';
  end if;

  -- Serialize membership changes for this institute and recheck authority after locking.
  perform 1 from public.coaching_institutes institute
  where institute.id = p_institute_id
  for update;
  if not found or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;

  select membership.role, membership.is_active
  into v_target_role, v_target_active
  from public.user_memberships membership
  where membership.institute_id = p_institute_id
    and membership.user_id = p_user_id
  for update;
  if not found then
    raise exception 'This institute membership was not found.' using errcode = '22023';
  end if;

  select membership.role into v_actor_role
  from public.user_memberships membership
  where membership.institute_id = p_institute_id
    and membership.user_id = v_actor_id
    and membership.is_active;

  if p_user_id = v_actor_id then
    raise exception 'You cannot remove your own membership here.' using errcode = '42501';
  end if;
  if v_target_role in ('owner', 'administrator') and v_actor_role <> 'owner' then
    raise exception 'Only an institute owner can remove an owner or administrator.' using errcode = '42501';
  end if;

  if v_target_role = 'owner' and v_target_active then
    select count(*) into v_active_owner_count
    from public.user_memberships membership
    where membership.institute_id = p_institute_id
      and membership.role = 'owner'
      and membership.is_active;
    if v_active_owner_count <= 1 then
      raise exception 'Transfer ownership before removing the last active owner.' using errcode = '23514';
    end if;
  end if;

  select lower(account.email) into v_target_email
  from auth.users account
  where account.id = p_user_id;

  -- Preserve invitation history, but make any still-pending invite unusable.
  if v_target_email is not null then
    update public.member_access_invitations invitation
    set status = 'revoked', updated_at = now()
    where invitation.institute_id = p_institute_id
      and lower(invitation.email) = v_target_email
      and invitation.status = 'pending';
  end if;

  -- Cascades only institute-scoped branch grants; the audit trigger records the removal.
  delete from public.user_memberships membership
  where membership.institute_id = p_institute_id
    and membership.user_id = p_user_id;
end;
$$;

revoke all on function public.remove_institute_member(text, uuid) from public, anon;
grant execute on function public.remove_institute_member(text, uuid) to authenticated;
