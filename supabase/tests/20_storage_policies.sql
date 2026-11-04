-- 20: the attachments bucket and its storage.objects policies (migrations 005
-- and 006). Users are impersonated exactly as storage-api does it (role
-- authenticated + request.jwt.claims), and objects are inserted / selected /
-- deleted in storage.objects directly, which is what storage-api runs for
-- upload, download/sign and remove. Deletes set storage.allow_delete_query
-- like storage-api (storage.protect_delete() refuses them otherwise). The
-- bytes in the storage backend are not involved; the HTTP path is verified
-- separately (docs/architecture.md, "Phase 3 review fixes": HTTP checks).
--
--   * bucket: private, 10 MB, MIME allow-list; exactly one policy (insert)
--     since migration 006
--   * insert: only with a pending attachments row uploaded by the caller,
--     membership, no existing object, metadata present with the row's MIME
--     type and (when present) its size; a successful upload stamps
--     uploaded_at and the row cannot be uploaded again
--   * select, update, delete: nobody (downloads go through attachment-url,
--     removal through the row delete and purge-attachments)
-- The reconciliation trigger for superuser (signed-URL) uploads is in 21.
create extension if not exists pgtap with schema extensions;

begin;
select plan(39);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Bucket configuration
-- ---------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'attachments'), false,
  'bucket attachments exists and is private');
select is((select file_size_limit from storage.buckets where id = 'attachments'), 10485760::bigint,
  'bucket attachments has a 10 MB file size limit');
select is(
  (select array(select unnest(allowed_mime_types) order by 1) from storage.buckets where id = 'attachments'),
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
        'text/csv', 'text/plain'],
  'bucket attachments allows exactly the eleven MIME types of the table check');
select ok(
  (select bool_and(public.attachment_content_type_is_allowed(t))
   from storage.buckets b, unnest(b.allowed_mime_types) t where b.id = 'attachments'),
  'every bucket MIME type passes attachments_content_type_check');
select policies_are('storage', 'objects',
  array['attachments_objects_insert_uploader'],
  'storage.objects has exactly one policy, the attachments insert policy (migration 006 dropped select and delete)');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and roles <> array['authenticated']::name[]),
  0, 'every storage.objects policy applies to authenticated only');

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): carol member and dave admin of A
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Member');
select tests.create_user(tests.dave(), 'dave@example.com', 'Dave Admin');
insert into public.workspace_members (workspace_id, user_id, role) values
  (tests.ws_a(), tests.carol(), 'member'),
  (tests.ws_a(), tests.dave(), 'admin');

select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_module(tests.mod_b(), tests.ws_b(), 'test-module-b');
select tests.create_record(tests.rec_a1(), tests.mod_a(), 'Record A1');
select tests.create_record(tests.rec_b1(), tests.mod_b(), 'Record B1');

select tests.remember_text('p_alice', tests.path_of(tests.create_attachment(tests.rec_a1(), 'alice.txt', tests.alice(), 12)));
select tests.remember_text('p_carol', tests.path_of(tests.create_attachment(tests.rec_a1(), 'carol.png', tests.carol(), 64, 'image/png')));
select tests.remember_text('p_bob', tests.path_of(tests.create_attachment(tests.rec_b1(), 'bob.txt', tests.bob(), 12)));

-- ---------------------------------------------------------------------------
-- Insert (upload)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select ok(not public.can_upload_attachment_object(tests.recall_text('p_alice'), null),
  'alice: an insert without metadata is refused (migration 006)');
select ok(not public.can_upload_attachment_object(tests.recall_text('p_alice'), '{"contentLength": 264}'),
  'alice: an insert whose metadata has no mimetype is refused (migration 006)');
select ok(public.can_upload_attachment_object(tests.recall_text('p_alice'), '{"mimetype": "text/plain", "contentLength": 264}'),
  'alice: the pre-upload check (mimetype, request contentLength, no size yet) admits her own row''s path');
select lives_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$, tests.recall_text('p_alice')),
  'alice: uploads to the path of her attachments row');
select isnt((select uploaded_at from public.attachments where storage_path = tests.recall_text('p_alice')), null,
  'alice: the upload stamped uploaded_at on the row');
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$, tests.recall_text('p_alice')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'alice: a second upload to the same path is refused (object exists, no overwrite)');
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$,
         tests.ws_a()::text || '/' || tests.rec_a1()::text || '/' || gen_random_uuid()::text || '-norow.txt'),
  '42501', 'new row violates row-level security policy for table "objects"',
  'alice: upload to a path without an attachments row is refused');
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$, tests.recall_text('p_bob')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'alice: upload to the path of a row in workspace B is refused');
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$,
         tests.ws_b()::text || '/' || tests.rec_b1()::text || '/x-free.txt'),
  '42501', 'new row violates row-level security policy for table "objects"',
  'alice: upload anywhere under B''s prefix is refused');
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(64, 'image/png'))$sql$, tests.recall_text('p_carol')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'alice (owner): upload to carol''s row is refused (only the uploader uploads)');

select tests.login_as(tests.carol());
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(65, 'image/png'))$sql$, tests.recall_text('p_carol')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'carol: an object whose size differs from size_bytes is refused');
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(64, 'image/jpeg'))$sql$, tests.recall_text('p_carol')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'carol: an object whose MIME type differs from content_type is refused');
select throws_ok(
  format($sql$select tests.put_object(%L, null)$sql$, tests.recall_text('p_carol')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'carol: an object without metadata is refused');
select lives_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(64, 'image/png'))$sql$, tests.recall_text('p_carol')),
  'carol (member): uploads to her own row''s path');

select tests.login_as(tests.bob());
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$,
         tests.ws_a()::text || '/' || tests.rec_a1()::text || '/x-free.txt'),
  '42501', 'new row violates row-level security policy for table "objects"',
  'bob: upload under A''s prefix is refused');
select lives_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12, 'text/plain;charset=UTF-8'))$sql$, tests.recall_text('p_bob')),
  'bob: uploads to his own row in B (MIME parameters such as charset are ignored)');

-- ---------------------------------------------------------------------------
-- Select (download, signed URL, list): nobody, not even the uploader
-- ---------------------------------------------------------------------------
select is((select count(*)::int from storage.objects where name = tests.recall_text('p_bob')), 0,
  'bob: does not see his own object (no select policy; downloads go through attachment-url)');
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 0,
  'bob: sees no object in the attachments bucket');

select tests.login_as(tests.alice());
select is((select count(*)::int from storage.objects where name in (tests.recall_text('p_alice'), tests.recall_text('p_carol'))), 0,
  'alice: does not see her own or carol''s object');
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 0,
  'alice: sees no object in the attachments bucket');

-- ---------------------------------------------------------------------------
-- Update: never
-- ---------------------------------------------------------------------------
select is(tests.rows_affected(format($sql$update storage.objects set name = name || '.moved' where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'alice: update (move/overwrite) of her own object affects 0 rows');

-- ---------------------------------------------------------------------------
-- Delete: nobody (removal is the row delete plus purge-attachments)
-- ---------------------------------------------------------------------------
select tests.allow_storage_delete();
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'alice: delete of her own object affects 0 rows');
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_bob'))),
  0, 'alice: delete of B''s object affects 0 rows');

select tests.login_as(tests.dave());
select tests.allow_storage_delete();
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'dave (admin): delete of alice''s object affects 0 rows');

select tests.login_as(tests.carol());
select tests.allow_storage_delete();
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_carol'))),
  0, 'carol (member): delete of her own object affects 0 rows');

select tests.login_as(tests.bob());
select tests.allow_storage_delete();
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'bob: delete of A''s object affects 0 rows');

-- An uploaded row cannot be filled again, even after its object is gone.
select tests.logout();
select tests.allow_storage_delete();
delete from storage.objects where name = tests.recall_text('p_alice');
select tests.login_as(tests.alice());
select throws_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$, tests.recall_text('p_alice')),
  '42501', 'new row violates row-level security policy for table "objects"',
  'alice: a row that was already uploaded cannot be uploaded again (uploaded_at is set)');

-- The row delete queues the object; the object stays unreachable for clients.
select tests.logout();
delete from public.attachments where storage_path = tests.recall_text('p_carol');
select is((select count(*)::int from public.storage_deletion_queue where object_name = tests.recall_text('p_carol')), 1,
  'postgres: deleting carol''s row queued her object');
select tests.login_as(tests.carol());
select is((select count(*)::int from storage.objects where name = tests.recall_text('p_carol')), 0,
  'carol: the orphaned object is not visible');
select tests.logout();
select is((select count(*)::int from storage.objects where name in (tests.recall_text('p_bob'), tests.recall_text('p_carol'))), 2,
  'postgres: B''s object and carol''s queued object survived every client attempt');

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
select tests.login_as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'attachments'), 0,
  'anon: sees no object in the attachments bucket');
select throws_ok(
  format($sql$insert into storage.objects (bucket_id, name, metadata) values ('attachments', %L, tests.object_meta(12))$sql$,
         tests.ws_a()::text || '/' || tests.rec_a1()::text || '/x-anon.txt'),
  '42501', 'new row violates row-level security policy for table "objects"',
  'anon: cannot upload into the attachments bucket');
select throws_ok(
  format($sql$select public.can_upload_attachment_object(%L, null)$sql$, tests.recall_text('p_bob')),
  '42501', 'permission denied for function can_upload_attachment_object',
  'anon: cannot execute can_upload_attachment_object');

select tests.logout();
select * from finish();
rollback;
