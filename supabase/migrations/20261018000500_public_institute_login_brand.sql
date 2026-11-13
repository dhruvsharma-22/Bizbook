-- Reveal only the active institute's display name for its member-login page.
-- The exact-ID function avoids granting anonymous access to the institute table.
create or replace function public.get_institute_login_brand(p_institute_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(i.business_name), '')
  from public.coaching_institutes as i
  where i.id = p_institute_id
    and i.account_status = 'active';
$$;

revoke all on function public.get_institute_login_brand(text) from public;
grant execute on function public.get_institute_login_brand(text) to anon, authenticated;

comment on function public.get_institute_login_brand(text) is
  'Returns only the display name of one active institute for its member-login page.';
