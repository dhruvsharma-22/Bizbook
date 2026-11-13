-- A branch invitation can lose its last branch when a branch is deactivated or
-- its login email changes. The sync trigger revokes the invitation and clears
-- its branch_ids; allow that empty terminal state while keeping active branch
-- invitations and institute-wide invitations constrained as before.

alter table public.member_access_invitations
  drop constraint if exists member_access_invitations_check;

alter table public.member_access_invitations
  add constraint member_access_invitations_scope_branches_check
  check (
    (access_scope = 'institute' and cardinality(branch_ids) = 0)
    or (access_scope = 'branches' and cardinality(branch_ids) > 0)
    or (access_scope = 'branches' and status in ('revoked', 'expired') and cardinality(branch_ids) = 0)
  );
