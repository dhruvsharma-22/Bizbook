-- Institute managers need to see inactive branches to reactivate them. Branch-scoped
-- members continue to see only branches allowed by can_access_branch.
drop policy if exists branches_select_accessible on public.branches;
create policy branches_select_accessible on public.branches for select to authenticated
  using (
    bizbook_private.can_manage_institute(institute_id)
    or bizbook_private.can_access_branch(institute_id, id)
  );
