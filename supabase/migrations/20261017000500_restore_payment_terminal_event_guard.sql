-- Keep the terminal-order protection while the payment finalizer also records
-- a distinct second capture as unmatched reconciliation activity.
do $restore_terminal_guard$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.process_online_payment_status(text,text,text,text,numeric,text,text,text,text)'::regprocedure
  );
  v_marker text := $$  if p_provider_status = 'captured' then$$;
  v_guard text := $guard$
  if v_order.order_status in ('Failed', 'Cancelled')
     and p_provider_status in ('authorized', 'pending', 'failed', 'cancelled') then
    if v_event_id is not null then
      update public.webhook_events set processing_status = 'Ignored', processed_at = now() where id = v_event_id;
    end if;
    return jsonb_build_object('status', lower(v_order.order_status), 'ignored', true);
  end if;

$guard$;
  v_position integer;
begin
  if pg_catalog.strpos(v_definition, 'order_status in (''Failed'', ''Cancelled'')') > 0 then
    raise exception 'Payment terminal-event guard already exists; review corrective migration before applying.';
  end if;
  v_position := pg_catalog.strpos(v_definition, v_marker);
  if v_position = 0 then
    raise exception 'Payment finalizer status branch changed; review terminal-event guard before applying.';
  end if;
  execute pg_catalog.replace(v_definition, v_marker, v_guard || v_marker);
end;
$restore_terminal_guard$;
