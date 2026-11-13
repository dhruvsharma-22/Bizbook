-- Store institute profile logos in private Supabase Storage instead of browser storage.
alter table public.coaching_institutes
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bizbook-institute-logos',
  'bizbook-institute-logos',
  false,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 1048576,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists bizbook_institute_logos_select on storage.objects;
create policy bizbook_institute_logos_select
on storage.objects for select to authenticated
using (
  bucket_id = 'bizbook-institute-logos'
  and exists (
    select 1 from public.coaching_institutes i
    where i.id = (storage.foldername(name))[1]
      and bizbook_private.has_institute_access(i.id)
  )
);

drop policy if exists bizbook_institute_logos_insert on storage.objects;
create policy bizbook_institute_logos_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'bizbook-institute-logos'
  and exists (
    select 1 from public.coaching_institutes i
    where i.id = (storage.foldername(name))[1]
      and bizbook_private.can_manage_institute(i.id)
  )
);

drop policy if exists bizbook_institute_logos_update on storage.objects;
create policy bizbook_institute_logos_update
on storage.objects for update to authenticated
using (
  bucket_id = 'bizbook-institute-logos'
  and exists (
    select 1 from public.coaching_institutes i
    where i.id = (storage.foldername(name))[1]
      and bizbook_private.can_manage_institute(i.id)
  )
)
with check (
  bucket_id = 'bizbook-institute-logos'
  and exists (
    select 1 from public.coaching_institutes i
    where i.id = (storage.foldername(name))[1]
      and bizbook_private.can_manage_institute(i.id)
  )
);

drop policy if exists bizbook_institute_logos_delete on storage.objects;
create policy bizbook_institute_logos_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'bizbook-institute-logos'
  and exists (
    select 1 from public.coaching_institutes i
    where i.id = (storage.foldername(name))[1]
      and bizbook_private.can_manage_institute(i.id)
  )
);
