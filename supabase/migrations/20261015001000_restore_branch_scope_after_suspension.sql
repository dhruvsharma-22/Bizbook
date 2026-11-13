-- Preserve the existing branch-scope invariant while also denying suspended accounts.
create or replace function bizbook_private.can_access_branch(p_institute_id text, p_branch_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and i.account_status = 'active'
      and (p_branch_id is null or exists (
        select 1 from public.branches b where b.institute_id = p_institute_id
          and b.id = p_branch_id and b.is_active
      ))
      and (p_branch_id is not null or m.access_scope = 'institute')
      and (p_branch_id is null or m.access_scope = 'institute' or exists (
        select 1 from public.membership_branch_access mba where mba.institute_id = m.institute_id
          and mba.user_id = m.user_id and mba.branch_id = p_branch_id
      ))
  );
$$;
