-- Replace the initial profile-import RPC with portable JSON key counting.
-- The initial migration's jsonb_object_length call is not available on PostgreSQL.
create or replace function public.import_legacy_business_profile(
  p_institute_id text,
  p_profile jsonb,
  p_confirm_no_overwrite boolean
)
returns table (filled_fields text[], skipped_fields text[], was_already_imported boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.legacy_business_profile_imports%rowtype;
  v_institute public.coaching_institutes%rowtype;
  v_normalized jsonb;
  v_fingerprint text;
  v_filled text[] := '{}';
  v_skipped text[] := '{}';
  v_import_id uuid;
  v_key text;
  v_value text;
  v_current text;
  v_business_name text;
  v_owner_name text;
  v_phone text;
  v_whatsapp text;
  v_email text;
  v_website text;
  v_address text;
  v_city text;
  v_state text;
  v_pincode text;
  v_gstin text;
begin
  if v_actor_id is null
     or auth.role() is distinct from 'authenticated'
     or not exists (
       select 1 from public.user_memberships membership
       where membership.institute_id = p_institute_id and membership.user_id = v_actor_id
         and membership.is_active and membership.role in ('owner', 'administrator')
         and membership.access_scope = 'institute'
     ) then
    raise exception 'Authorized institute administrator access is required.' using errcode = '42501';
  end if;

  if p_confirm_no_overwrite is distinct from true
     or p_profile is null or jsonb_typeof(p_profile) is distinct from 'object'
     or p_profile = '{}'::jsonb then
    raise exception 'Legacy profile fields or explicit no-overwrite confirmation are invalid.' using errcode = '22023';
  end if;
  if (p_profile - array['businessName','ownerName','phone','whatsapp','email','website','address','city','state','pincode','gstin']::text[]) <> '{}'::jsonb
     or (select count(*) from jsonb_object_keys(p_profile)) > 11
     or exists (select 1 from jsonb_each(p_profile) item where jsonb_typeof(item.value) is distinct from 'string') then
    raise exception 'Legacy profile fields or explicit no-overwrite confirmation are invalid.' using errcode = '22023';
  end if;

  v_business_name := nullif(btrim(p_profile->>'businessName'), '');
  v_owner_name := nullif(btrim(p_profile->>'ownerName'), '');
  v_phone := nullif(btrim(p_profile->>'phone'), '');
  v_whatsapp := nullif(btrim(p_profile->>'whatsapp'), '');
  v_email := nullif(btrim(p_profile->>'email'), '');
  v_website := nullif(btrim(p_profile->>'website'), '');
  v_address := nullif(btrim(p_profile->>'address'), '');
  v_city := nullif(btrim(p_profile->>'city'), '');
  v_state := nullif(btrim(p_profile->>'state'), '');
  v_pincode := nullif(btrim(p_profile->>'pincode'), '');
  v_gstin := nullif(upper(btrim(p_profile->>'gstin')), '');

  if (v_business_name is not null and length(v_business_name) > 100)
     or (v_owner_name is not null and length(v_owner_name) > 100)
     or (v_phone is not null and v_phone !~ '^[0-9]{10}$')
     or (v_whatsapp is not null and v_whatsapp !~ '^[0-9]{10}$')
     or (v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
     or (v_website is not null and (length(v_website) > 2048 or v_website !~* '^https?://[^[:space:]]+$'))
     or (v_address is not null and length(v_address) > 250)
     or (v_city is not null and length(v_city) > 50)
     or (v_state is not null and length(v_state) > 50)
     or (v_pincode is not null and v_pincode !~ '^[0-9]{6}$')
     or (v_gstin is not null and v_gstin !~ '^[A-Z0-9]{15}$') then
    raise exception 'Legacy profile fields or explicit no-overwrite confirmation are invalid.' using errcode = '22023';
  end if;

  v_normalized := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'businessName', v_business_name, 'ownerName', v_owner_name, 'phone', v_phone,
    'whatsapp', v_whatsapp, 'email', v_email, 'website', v_website,
    'address', v_address, 'city', v_city, 'state', v_state,
    'pincode', v_pincode, 'gstin', v_gstin
  ));
  if v_normalized = '{}'::jsonb then
    raise exception 'Legacy profile has no non-empty fields to import.' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'institute_id', p_institute_id, 'source_key', 'bizbook-business-profile',
    'source_record_id', 'business-profile-v1', 'profile', v_normalized
  )::text, 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_institute_id || chr(31) || 'bizbook-business-profile', 0)
  );
  select item.* into v_existing from public.legacy_business_profile_imports item
  where item.institute_id = p_institute_id and item.source_key = 'bizbook-business-profile' for update;
  if found then
    if v_existing.source_fingerprint is distinct from v_fingerprint then
      raise exception 'This legacy business profile changed after a previous import.' using errcode = '23505';
    end if;
    return query select v_existing.imported_fields, v_existing.skipped_fields, true;
    return;
  end if;

  select item.* into v_institute from public.coaching_institutes item where item.id = p_institute_id for update;
  if not found then raise exception 'The target institute does not exist.' using errcode = '23503'; end if;

  for v_key, v_value in select key, value from jsonb_each_text(v_normalized) loop
    v_current := case v_key
      when 'businessName' then v_institute.business_name
      when 'ownerName' then v_institute.owner_name
      when 'phone' then v_institute.phone
      when 'whatsapp' then v_institute.whatsapp
      when 'email' then v_institute.email
      when 'website' then v_institute.website
      when 'address' then v_institute.address
      when 'city' then v_institute.city
      when 'state' then v_institute.state
      when 'pincode' then v_institute.pincode
      when 'gstin' then v_institute.gstin
    end;
    if nullif(btrim(v_current), '') is null then v_filled := array_append(v_filled, v_key);
    else v_skipped := array_append(v_skipped, v_key); end if;
  end loop;

  if cardinality(v_filled) > 0 then
    update public.coaching_institutes set
      business_name = case when 'businessName' = any(v_filled) then v_business_name else business_name end,
      owner_name = case when 'ownerName' = any(v_filled) then v_owner_name else owner_name end,
      phone = case when 'phone' = any(v_filled) then v_phone else phone end,
      whatsapp = case when 'whatsapp' = any(v_filled) then v_whatsapp else whatsapp end,
      email = case when 'email' = any(v_filled) then v_email else email end,
      website = case when 'website' = any(v_filled) then v_website else website end,
      address = case when 'address' = any(v_filled) then v_address else address end,
      city = case when 'city' = any(v_filled) then v_city else city end,
      state = case when 'state' = any(v_filled) then v_state else state end,
      pincode = case when 'pincode' = any(v_filled) then v_pincode else pincode end,
      gstin = case when 'gstin' = any(v_filled) then v_gstin else gstin end,
      updated_at = now()
    where id = p_institute_id;
  end if;

  insert into public.legacy_business_profile_imports (
    institute_id, source_key, source_fingerprint, imported_fields, skipped_fields, imported_by
  ) values (
    p_institute_id, 'bizbook-business-profile', v_fingerprint, v_filled, v_skipped, v_actor_id
  ) returning id into v_import_id;
  insert into public.audit_logs (institute_id, entity_type, entity_id, action, actor_id, metadata)
  values (p_institute_id, 'legacy_business_profile_import', v_import_id::text, 'INSERT', v_actor_id,
    pg_catalog.jsonb_build_object('source_key', 'bizbook-business-profile', 'filled_fields', v_filled, 'skipped_fields', v_skipped));
  return query select v_filled, v_skipped, false;
end;
$$;

revoke all on function public.import_legacy_business_profile(text, jsonb, boolean) from public, anon, service_role;
grant execute on function public.import_legacy_business_profile(text, jsonb, boolean) to authenticated;
notify pgrst, 'reload schema';
