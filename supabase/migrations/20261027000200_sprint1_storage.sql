-- Private bucket for property photos. Files live at "<property_id>/<file name>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-photos', 'property-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "property photos read" on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and app.can_access_property(((storage.foldername(name))[1])::uuid));

create policy "property photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and app.can_manage_property(((storage.foldername(name))[1])::uuid));

create policy "property photos update" on storage.objects for update to authenticated
  using (bucket_id = 'property-photos' and app.can_manage_property(((storage.foldername(name))[1])::uuid));

create policy "property photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and app.can_manage_property(((storage.foldername(name))[1])::uuid));
