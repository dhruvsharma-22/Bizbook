create or replace function public.list_institute_members(p_institute_id text)
returns table (
  user_id uuid,
  email text,
  role text,
  access_scope text,
  is_active boolean
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
  select membership.user_id, coalesce(account.email, ''), membership.role,
         membership.access_scope, membership.is_active
  from public.user_memberships membership
  left join auth.users account on account.id = membership.user_id
  where membership.institute_id = p_institute_id
    and bizbook_private.can_manage_institute(p_institute_id)
  order by lower(coalesce(account.email, '')), membership.role;
end;
$$;

create or replace function public.grant_institute_membership_by_email(
  p_institute_id text,
  p_email text,
  p_role text,
  p_access_scope text,
  p_branch_ids text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_match_count integer;
  v_user_id uuid;
  v_branch_id text;
  v_branches text[] := coalesce(p_branch_ids, '{}'::text[]);
  v_actor_is_owner boolean;
begin
  if auth.uid() is null or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;
  if p_institute_id is null or length(v_email) > 254 or v_email = ''
     or position('@' in v_email) < 2 or p_role is null
     or p_role not in ('owner', 'administrator', 'accountant', 'staff')
     or p_access_scope is null or p_access_scope not in ('institute', 'branches') then
    raise exception 'Member email, role, or access scope is invalid.' using errcode = '22023';
  end if;
  if (p_access_scope = 'branches' and cardinality(v_branches) = 0)
     or (p_access_scope = 'institute' and cardinality(v_branches) > 0) then
    raise exception 'Choose at least one branch only for branch-scoped access.' using errcode = '22023';
  end if;

  perform 1 from public.coaching_institutes institute
  where institute.id = p_institute_id for update;
  if not found or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception 'Institute administrator access is required.' using errcode = '42501';
  end if;

  select count(*)::integer, (array_agg(account.id))[1]
  into v_match_count, v_user_id
  from auth.users account
  where lower(account.email) = v_email and account.email_confirmed_at is not null;
  if v_match_count = 0 then
    raise exception 'No verified BizBook account uses this email. Ask the person to register and verify their email first.' using errcode = '22023';
  end if;
  if v_match_count <> 1 then
    raise exception 'This email matches more than one account; ask support to resolve it.' using errcode = '22023';
  end if;

  select membership.role = 'owner' into v_actor_is_owner
  from public.user_memberships membership
  where membership.institute_id = p_institute_id
    and membership.user_id = auth.uid() and membership.is_active;
  if p_role in ('owner', 'administrator') and not coalesce(v_actor_is_owner, false) then
    raise exception 'Only an institute owner may grant owner or administrator roles.' using errcode = '42501';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Manage your own access from another institute owner account.' using errcode = '42501';
  end if;

  perform public.grant_institute_membership(p_institute_id, v_user_id, p_role, p_access_scope);

  if p_access_scope = 'branches' then
    delete from public.membership_branch_access access_row
    where access_row.institute_id = p_institute_id
      and access_row.user_id = v_user_id
      and not (access_row.branch_id = any(v_branches));
    foreach v_branch_id in array v_branches loop
      perform public.set_membership_branch_access(p_institute_id, v_user_id, v_branch_id, true);
    end loop;
  end if;
end;
$$;

revoke all on function public.list_institute_members(text) from public, anon;
revoke all on function public.grant_institute_membership_by_email(text, text, text, text, text[]) from public, anon;
grant execute on function public.list_institute_members(text) to authenticated;
grant execute on function public.grant_institute_membership_by_email(text, text, text, text, text[]) to authenticated;

comment on function public.list_institute_members(text)
  is 'Returns member email addresses only to authorized institute owners and administrators.';
comment on function public.grant_institute_membership_by_email(text, text, text, text, text[])
  is 'Atomically grants a role and branch permissions to an existing verified Auth email without exposing UUID entry in the application.';
