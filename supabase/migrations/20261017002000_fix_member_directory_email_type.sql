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
  select membership.user_id, coalesce(account.email::text, ''), membership.role,
         membership.access_scope, membership.is_active
  from public.user_memberships membership
  left join auth.users account on account.id = membership.user_id
  where membership.institute_id = p_institute_id
    and bizbook_private.can_manage_institute(p_institute_id)
  order by lower(coalesce(account.email::text, '')), membership.role;
end;
$$;
