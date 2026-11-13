-- Read-only investigation of the catalog routine that is executable by anon.
select pg_catalog.pg_get_functiondef('public.rls_auto_enable()'::regprocedure) as definition,
       p.proowner::regrole::text as owner,
       l.lanname as language,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       p.proacl as acl,
       exists (
         select 1 from pg_catalog.pg_trigger t
         where t.tgfoid = p.oid and not t.tgisinternal
       ) as attached_to_user_trigger
from pg_catalog.pg_proc p
join pg_catalog.pg_language l on l.oid = p.prolang
where p.oid = 'public.rls_auto_enable()'::regprocedure;
