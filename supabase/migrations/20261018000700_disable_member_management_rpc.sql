-- The user-facing member-management feature has been retired. Preserve all
-- membership rows and RLS checks, but disable the old role-management RPCs.
revoke all on function public.list_institute_members(text) from public, anon, authenticated;
revoke all on function public.grant_institute_membership(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.grant_institute_membership_by_email(text, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.deactivate_institute_membership(text, uuid) from public, anon, authenticated;
revoke all on function public.remove_institute_member(text, uuid) from public, anon, authenticated;
revoke all on function public.set_membership_branch_access(text, uuid, text, boolean) from public, anon, authenticated;

revoke all on function public.create_member_access_invitation(text, text, text, text, text[])
  from public, anon, authenticated;
revoke all on function public.list_member_access_invitations(text) from public, anon, authenticated;
revoke all on function public.revoke_member_access_invitation(uuid) from public, anon, authenticated;
revoke all on function public.accept_pending_member_access_invitations() from public, anon, authenticated;

comment on function public.grant_institute_membership(text, uuid, text, text) is
  'Retired user-facing membership-management RPC; execution restricted to database owners.';
