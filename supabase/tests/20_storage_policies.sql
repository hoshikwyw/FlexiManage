-- 20: the attachments bucket and its storage.objects policies (migration 005).
-- Users are impersonated exactly as storage-api does it (role authenticated +
-- request.jwt.claims), and objects are inserted / selected / deleted in
-- storage.objects directly, which is what storage-api runs for upload,
-- download/sign and remove. Deletes set storage.allow_delete_query like
-- storage-api (storage.protect_delete() refuses them otherwise). The bytes in
-- the storage backend are not involved; the HTTP path is verified separately
-- (docs/architecture.md, "Attachments": HTTP checks).
--
--   * bucket: private, 10 MB, MIME allow-list; exactly three policies
--   * insert: only with a matching attachments row uploaded by the caller,
--     membership, no existing object, matching size and MIME type
--   * select: members of the row's workspace only; 0 across workspaces;
--     nothing once the row is gone
--   * delete: uploader or owner/admin while the row exists; nobody else
--   * update: never
create extension if not exists pgtap with schema extensions;

begin;
select plan(40);
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
  array['attachments_objects_select_member', 'attachments_objects_insert_uploader',
        'attachments_objects_delete_uploader_or_owner_admin'],
  'storage.objects has exactly the three attachments policies');
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
select ok(public.can_upload_attachment_object(tests.recall_text('p_alice'), null),
  'alice: the pre-upload check (no metadata yet) admits her own row''s path');
select lives_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$, tests.recall_text('p_alice')),
  'alice: uploads to the path of her attachments row');
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
-- Select (download, signed URL, list)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from storage.objects where bucket_id = 'attachments' and name like tests.ws_a()::text || '/%'), 0,
  'bob: select of objects under A''s prefix returns 0');
select is((select count(*)::int from storage.objects where name in (tests.recall_text('p_alice'), tests.recall_text('p_carol'))), 0,
  'bob: select of A''s objects by exact name returns 0');
select is_empty(
  format($sql$select name from storage.objects where bucket_id = 'attachments' and name not like %L$sql$, tests.ws_b()::text || '/%'),
  'bob: sees no object outside his workspace prefix');
select is((select count(*)::int from storage.objects where name = tests.recall_text('p_bob')), 1,
  'bob: sees his own object');

select tests.login_as(tests.alice());
select is((select count(*)::int from storage.objects where name = tests.recall_text('p_bob')), 0,
  'alice: select of B''s object returns 0');
select is_empty(
  format($sql$select name from storage.objects where bucket_id = 'attachments' and name not like %L$sql$, tests.ws_a()::text || '/%'),
  'alice: sees no object outside her workspace prefix');
select is((select count(*)::int from storage.objects where name in (tests.recall_text('p_alice'), tests.recall_text('p_carol'))), 2,
  'alice: sees her object and carol''s (same workspace)');
select ok(not public.can_read_attachment_object(tests.recall_text('p_bob')),
  'alice: can_read_attachment_object is false for B''s object');

-- ---------------------------------------------------------------------------
-- Update: never
-- ---------------------------------------------------------------------------
select is(tests.rows_affected(format($sql$update storage.objects set name = name || '.moved' where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'alice: update (move/overwrite) of her own object affects 0 rows');

-- ---------------------------------------------------------------------------
-- Delete
-- ---------------------------------------------------------------------------
select tests.allow_storage_delete();

select tests.login_as(tests.bob());
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'bob: delete of A''s object affects 0 rows');

select tests.login_as(tests.carol());
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'carol (member): delete of alice''s object affects 0 rows');
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_carol'))),
  1, 'carol (member): delete of her own object affects 1 row');

select tests.login_as(tests.dave());
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  1, 'dave (admin): delete of alice''s object affects 1 row');

select tests.login_as(tests.alice());
select lives_ok(
  format($sql$select tests.put_object(%L, tests.object_meta(12))$sql$, tests.recall_text('p_alice')),
  'alice: may upload again once the object is gone (the row still exists)');
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_bob'))),
  0, 'alice: delete of B''s object affects 0 rows');

-- Orphan: the row is deleted first (cascade or wrong client order).
select tests.logout();
delete from public.attachments where storage_path = tests.recall_text('p_alice');
select tests.login_as(tests.alice());
select tests.allow_storage_delete();
select is((select count(*)::int from storage.objects where name = tests.recall_text('p_alice')), 0,
  'alice: an object whose row is gone is no longer readable');
select is(tests.rows_affected(format($sql$delete from storage.objects where name = %L$sql$, tests.recall_text('p_alice'))),
  0, 'alice: an orphaned object is not deletable by clients (purge-attachments removes it)');
select tests.logout();
select is((select count(*)::int from public.storage_deletion_queue where object_name = tests.recall_text('p_alice')), 1,
  'postgres: the orphaned object is in the deletion queue');
select is((select count(*)::int from storage.objects where name = tests.recall_text('p_bob')), 1,
  'postgres: B''s object survived every attempt from A');

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
  format($sql$select public.can_read_attachment_object(%L)$sql$, tests.recall_text('p_bob')),
  '42501', 'permission denied for function can_read_attachment_object',
  'anon: cannot execute can_read_attachment_object');

select tests.logout();
select * from finish();
rollback;
