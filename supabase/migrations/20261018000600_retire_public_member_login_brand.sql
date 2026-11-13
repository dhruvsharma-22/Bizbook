-- Member-specific login was removed. Keep the historical migration intact,
-- but close its public display-name lookup so it is no longer exposed.
revoke all on function public.get_institute_login_brand(text) from public;
revoke all on function public.get_institute_login_brand(text) from anon, authenticated;

comment on function public.get_institute_login_brand(text) is
  'Retired: member-specific login was removed; execution is restricted to database owners.';
