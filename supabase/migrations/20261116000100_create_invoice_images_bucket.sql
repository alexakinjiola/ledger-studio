-- Public bucket for invoice item photos and company logos.
-- Files are readable by anyone with the URL (clients opening a shared invoice),
-- but each signed-in user can only write inside their own folder: <user_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-images', 'invoice-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "invoice-images: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "invoice-images: users read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoice-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "invoice-images: users delete own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'invoice-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
