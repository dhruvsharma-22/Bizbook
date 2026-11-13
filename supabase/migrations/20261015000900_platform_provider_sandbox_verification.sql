-- Record successful provider-side checks only from a trusted server after it performs
-- the actual API request. A check never activates or enables payment/message delivery.
create or replace function public.record_platform_provider_sandbox_check(
  p_provider_scope text, p_provider text, p_check_type text, p_actor_user_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_verified_at timestamptz := now(); v_updated integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_provider_scope is null or p_provider is null or p_check_type is null
     or p_provider_scope not in ('payment', 'email', 'whatsapp')
     or p_provider not in ('razorpay', 'cashfree', 'resend', 'whatsapp_cloud')
     or p_check_type not in ('unpaid_order_created', 'test_email_accepted', 'phone_profile_read') then
    raise exception using errcode = '22023', message = 'Provider check details are invalid';
  end if;
  if (p_provider_scope = 'payment' and p_check_type <> 'unpaid_order_created')
     or (p_provider_scope = 'email' and (p_provider <> 'resend' or p_check_type <> 'test_email_accepted'))
     or (p_provider_scope = 'whatsapp' and (p_provider <> 'whatsapp_cloud' or p_check_type <> 'phone_profile_read'))
     or (p_provider_scope = 'payment' and p_provider not in ('razorpay', 'cashfree')) then
    raise exception using errcode = '22023', message = 'Provider check type does not match the provider';
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_administrators where user_id = p_actor_user_id and role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'A platform owner must authorize the provider check';
  end if;
  update public.platform_provider_connections
     set last_verified_at = v_verified_at,
         connection_status = 'pending'
   where provider_scope = p_provider_scope and provider = p_provider
     and environment = 'test' and connection_status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0002', message = 'A pending test configuration was not found';
  end if;
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (p_actor_user_id, 'provider_sandbox_check_succeeded', 'platform_provider', p_provider_scope || ':' || p_provider,
          jsonb_build_object('environment', 'test', 'check_type', p_check_type, 'status_remains', 'pending'));
  return jsonb_build_object('provider_scope', p_provider_scope, 'provider', p_provider,
                            'environment', 'test', 'connection_status', 'pending',
                            'last_verified_at', v_verified_at, 'check_type', p_check_type);
end;
$$;

revoke all on function public.record_platform_provider_sandbox_check(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_platform_provider_sandbox_check(text, text, text, uuid) to service_role;
