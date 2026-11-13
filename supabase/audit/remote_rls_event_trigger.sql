-- Read-only check for the event trigger bound to public.rls_auto_enable().
select e.evtname as name, e.evtevent as event, e.evtenabled as enabled,
       e.evttags as command_tags
from pg_catalog.pg_event_trigger e
where e.evtfoid = 'public.rls_auto_enable()'::regprocedure;
