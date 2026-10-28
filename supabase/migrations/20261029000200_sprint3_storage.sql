-- Private bucket for meter photos. Files live at "<property_id>/<unit_id>/<date>-<utility>-<n>.jpg".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meter-photos', 'meter-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "meter photos read" on storage.objects for select to authenticated
  using (bucket_id = 'meter-photos' and app.can_access_property(((storage.foldername(name))[1])::uuid));

create policy "meter photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'meter-photos' and app.can_book(((storage.foldername(name))[1])::uuid));
