-- Keep product policy in application/database code. Platform Admin can create
-- named plan entries and edit prices, but cannot change trials, limits,
-- availability, descriptions, or included features from the browser.

create or replace function public.save_platform_subscription_plan_with_markdown(
  p_plan_id uuid, p_name text, p_description text, p_monthly_price numeric,
  p_annual_price numeric, p_monthly_compare_at_price numeric,
  p_annual_compare_at_price numeric, p_trial_days integer,
  p_student_limit integer, p_staff_limit integer, p_branch_limit integer,
  p_features jsonb, p_is_available boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_plan public.platform_subscription_plans%rowtype;
  v_actor uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_monthly_price is null or p_monthly_price < 0 or p_monthly_price > 9999999999.99
     or p_annual_price is null or p_annual_price < 0 or p_annual_price > 9999999999.99
     or (p_monthly_compare_at_price is not null and
         (p_monthly_compare_at_price < p_monthly_price or p_monthly_compare_at_price > 9999999999.99))
     or (p_annual_compare_at_price is not null and
         (p_annual_compare_at_price < p_annual_price or p_annual_compare_at_price > 9999999999.99)) then
    raise exception using errcode = '22023', message = 'Plan prices are invalid';
  end if;

  if p_plan_id is null then
    if p_name is null or length(btrim(p_name)) not between 1 and 100 then
      raise exception using errcode = '22023', message = 'A plan name is required';
    end if;

    -- These defaults are product policy owned by the application, not the
    -- Platform Admin form. Update them here when the code-defined plan policy
    -- is intentionally changed.
    v_id := public.save_platform_subscription_plan(
      null,
      btrim(p_name),
      'A complete BizBook workspace for managing your institute.',
      p_monthly_price,
      p_annual_price,
      0,
      null,
      null,
      null,
      jsonb_build_object('items', jsonb_build_array(
        'Shared institute workspace',
        'Financial reports and payment tracking',
        'Secure access for your institute team'
      )),
      true
    );
    update public.platform_subscription_plans
       set monthly_compare_at_price = p_monthly_compare_at_price,
           annual_compare_at_price = p_annual_compare_at_price
     where id = v_id;
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (
      v_actor,
      'subscription_plan_pricing_created',
      'subscription_plan',
      v_id::text,
      jsonb_build_object(
        'name', btrim(p_name),
        'monthly_price', p_monthly_price,
        'annual_price', p_annual_price,
        'monthly_compare_at_price', p_monthly_compare_at_price,
        'annual_compare_at_price', p_annual_compare_at_price
      )
    );
    return v_id;
  end if;

  select * into v_plan
    from public.platform_subscription_plans
   where id = p_plan_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Subscription plan was not found';
  end if;

  update public.platform_subscription_plans
     set monthly_price = p_monthly_price,
         annual_price = p_annual_price,
         monthly_compare_at_price = p_monthly_compare_at_price,
         annual_compare_at_price = p_annual_compare_at_price
   where id = p_plan_id;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (
    v_actor,
    'subscription_plan_pricing_updated',
    'subscription_plan',
    p_plan_id::text,
    jsonb_build_object(
      'name', v_plan.name,
      'monthly_price', p_monthly_price,
      'annual_price', p_annual_price,
      'monthly_compare_at_price', p_monthly_compare_at_price,
      'annual_compare_at_price', p_annual_compare_at_price
    )
  );
  return p_plan_id;
end;
$$;

-- Callers must go through the restricted wrapper above.
revoke all on function public.save_platform_subscription_plan(
  uuid, text, text, numeric, numeric, integer, integer, integer, integer, jsonb, boolean
) from public, anon, authenticated;
revoke all on function public.save_platform_subscription_plan_with_markdown(
  uuid, text, text, numeric, numeric, numeric, numeric, integer,
  integer, integer, integer, jsonb, boolean
) from public, anon;
grant execute on function public.save_platform_subscription_plan_with_markdown(
  uuid, text, text, numeric, numeric, numeric, numeric, integer,
  integer, integer, integer, jsonb, boolean
) to authenticated;
