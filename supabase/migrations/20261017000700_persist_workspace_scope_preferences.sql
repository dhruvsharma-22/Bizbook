-- Store the selected workspace scope per authenticated user without browser storage.
-- This preference never grants institute or branch access; memberships and RLS remain authoritative.

alter table public.profiles
  add column workspace_preferences jsonb not null default '{}'::jsonb
  check (jsonb_typeof(workspace_preferences) = 'object');

revoke update (workspace_preferences) on public.profiles from public, anon;
grant update (workspace_preferences) on public.profiles to authenticated;

comment on column public.profiles.workspace_preferences is
  'Non-authoritative per-user UI preferences. Every saved institute/branch selection must be revalidated against current membership and RLS-visible branches.';
