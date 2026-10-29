-- Private bucket for bank-transfer slips, under <org_id>/... (brief section 6).
-- Only staff/managers of that org may upload or read (reads go through short-lived signed URLs).
-- No UPDATE or DELETE policy: no overwrite via upsert, no user deletes. The server removes orphans with the secret key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880,
        array['image/jpeg', 'image/png', 'application/pdf']);

-- app.member_org_id() reads memberships only, so tenants (who have none) never match.
create policy payment_slips_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] = (select app.member_org_id())::text
  );

create policy payment_slips_select on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] = (select app.member_org_id())::text
  );
