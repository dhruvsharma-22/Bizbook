-- Existing users can still join another institute by email. Prevent a second
-- Add Member action from silently overwriting a membership in this institute.

alter function public.create_member_access_invitation(text, text, text, text, text[])
  rename to create_member_access_invitation_core;

revoke all on function public.create_member_access_invitation_core(text, text, text, text, text[])
  from public, anon, authenticated;

create function public.create_member_access_invitation(
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
  v_user_id uuid;
begin
  if auth.uid() is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;

  select account.id into v_user_id
  from auth.users account
  where pg_catalog.lower(account.email) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')))
  order by account.created_at desc
  limit 1;

  if v_user_id is not null and exists (
    select 1
    from public.user_memberships membership
    where membership.institute_id = p_institute_id
      and membership.user_id = v_user_id
  ) then
    raise exception 'This person already has a membership in this institute. Manage or restore their existing membership instead.'
      using errcode = '23505';
  end if;

  return public.create_member_access_invitation_core(
    p_institute_id, p_email, p_role, p_access_scope, p_branch_ids
  );
end;
$$;

revoke all on function public.create_member_access_invitation(text, text, text, text, text[])
  from public, anon;
grant execute on function public.create_member_access_invitation(text, text, text, text, text[])
  to authenticated;
