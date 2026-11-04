-- 19: public.attachments (migration 005).
--   * the four section 7 matrix cells for `attachments` (table) in both
--     directions; update is denied for everyone (no update grant)
--   * composite FK: an attachment in A can never point at a record of B
--   * member inserts and deletes own; cannot delete another member's; admin
--     and owner can
--   * file name, content type and size checks; cap of 10 per record
--   * storage_path is generated and not client-settable; id and uploaded_by
--     are not insertable
--   * audit rows attachment.added / attachment.removed with exactly
--     { record_id, file_name, size_bytes }
--   * cleanup queue: direct, record-cascade and workspace-cascade deletes
--     enqueue the object; the queue is invisible to clients
--   * workspace_usage() attachments and storage_bytes (uploaded rows only
--     since migration 006)
--
-- Independent of pre-existing rows: users, modules, records and attachments
-- are fixtures created here; destructive steps are scoped to fixture ids.
create extension if not exists pgtap with schema extensions;

begin;
select plan(65);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Member');
select tests.create_user(tests.dave(), 'dave@example.com', 'Dave Admin');
insert into public.workspace_members (workspace_id, user_id, role) values
  (tests.ws_a(), tests.carol(), 'member'),
  (tests.ws_a(), tests.dave(), 'admin');

select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_module(tests.mod_b(), tests.ws_b(), 'test-module-b');
select tests.create_record(tests.rec_a1(), tests.mod_a(), 'Record A1');
select tests.create_record(tests.rec_a2(), tests.mod_a(), 'Record A2');
select tests.create_record(tests.rec_b1(), tests.mod_b(), 'Record B1');

select tests.remember_text('att_a', tests.create_attachment(tests.rec_a1(), 'contract.pdf', tests.alice(), 2048, 'application/pdf')::text);
select tests.remember_text('att_b', tests.create_attachment(tests.rec_b1(), 'plan.png', tests.bob(), 4096, 'image/png')::text);

create temp table att_before as
  select * from public.attachments
  where id in (tests.recall_text('att_a')::uuid, tests.recall_text('att_b')::uuid);
grant select on att_before to authenticated;

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.attachments where workspace_id = tests.ws_b()), 0,
  'alice: select of attachments in B returns 0 rows');
select is((select count(*)::int from public.attachments where record_id = tests.rec_b1()), 0,
  'alice: select of attachments by B''s record id returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.attachments
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no attachment outside the workspaces she belongs to');
select is((select count(*)::int from public.attachments where id = tests.recall_text('att_a')::uuid), 1,
  'alice: sees the attachment in A');

select throws_ok(
  format($sql$select tests.create_attachment(%L, 'hijack.txt')$sql$, tests.rec_b1()),
  '42501', 'new row violates row-level security policy for table "attachments"',
  'alice: insert of an attachment with workspace B id is rejected by RLS');
select throws_ok(
  format($sql$select tests.create_attachment(%L, 'hijack.txt', p_ws => %L)$sql$, tests.rec_b1(), tests.ws_a()),
  '23503', null,
  'alice: insert of an attachment in A pointing at a record of B fails the composite FK');
select throws_ok(
  format($sql$update public.attachments set file_name = 'pwned.txt' where id = %L$sql$, tests.recall_text('att_b')),
  '42501', 'permission denied for table attachments',
  'alice: update of B''s attachment is denied (no update grant for anyone)');
select is(tests.rows_affected(format($sql$delete from public.attachments where id = %L$sql$, tests.recall_text('att_b'))),
  0, 'alice: delete of B''s attachment affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.attachments where workspace_id = %L$sql$, tests.ws_b())),
  0, 'alice: delete of all attachments in B affects 0 rows');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.attachments where workspace_id = tests.ws_a()), 0,
  'bob: select of attachments in A returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.attachments
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.bob()),
  'bob: sees no attachment outside the workspaces he belongs to');
select is((select count(*)::int from public.attachments where id = tests.recall_text('att_b')::uuid), 1,
  'bob: sees the attachment in B');
select throws_ok(
  format($sql$select tests.create_attachment(%L, 'hijack.txt')$sql$, tests.rec_a1()),
  '42501', 'new row violates row-level security policy for table "attachments"',
  'bob: insert of an attachment with workspace A id is rejected by RLS');
select throws_ok(
  format($sql$select tests.create_attachment(%L, 'hijack.txt', p_ws => %L)$sql$, tests.rec_a1(), tests.ws_b()),
  '23503', null,
  'bob: insert of an attachment in B pointing at a record of A fails the composite FK');
select throws_ok(
  format($sql$update public.attachments set file_name = 'pwned.txt' where id = %L$sql$, tests.recall_text('att_a')),
  '42501', 'permission denied for table attachments',
  'bob: update of A''s attachment is denied');
select is(tests.rows_affected(format($sql$delete from public.attachments where id = %L$sql$, tests.recall_text('att_a'))),
  0, 'bob: delete of A''s attachment affects 0 rows');
select is((select count(*)::int from public.audit_events
           where workspace_id = tests.ws_a() and action like 'attachment.%'), 0,
  'bob: sees no attachment audit events of A');

select tests.logout();
select results_eq(
  format('select * from public.attachments where id in (%L, %L) order by id', tests.recall_text('att_a'), tests.recall_text('att_b')),
  'select * from att_before order by id',
  'postgres: both fixture attachments are unchanged after the cross-workspace attempts');
select is((select count(*)::int from public.attachments where file_name = 'hijack.txt'), 0,
  'postgres: no hijack attachment was created');

-- ---------------------------------------------------------------------------
-- storage_path, column grants
-- ---------------------------------------------------------------------------
select is(tests.path_of(tests.recall_text('att_a')::uuid),
  tests.ws_a()::text || '/' || tests.rec_a1()::text || '/' || tests.recall_text('att_a') || '-contract.pdf',
  'storage_path is <workspace_id>/<record_id>/<id>-<file_name>');

select tests.login_as(tests.carol());
select throws_ok(
  format($sql$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes, storage_path)
              values (%L, %L, 'x.txt', 'text/plain', 1, 'elsewhere/x.txt')$sql$, tests.ws_a(), tests.rec_a1()),
  '428C9', null,
  'carol: storage_path cannot be supplied (generated column)');
select throws_ok(
  format($sql$insert into public.attachments (id, workspace_id, record_id, file_name, content_type, size_bytes)
              values (gen_random_uuid(), %L, %L, 'x.txt', 'text/plain', 1)$sql$, tests.ws_a(), tests.rec_a1()),
  '42501', 'permission denied for table attachments',
  'carol: id cannot be supplied (column grant)');
select throws_ok(
  format($sql$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes, uploaded_by)
              values (%L, %L, 'x.txt', 'text/plain', 1, %L)$sql$, tests.ws_a(), tests.rec_a1(), tests.alice()),
  '42501', 'permission denied for table attachments',
  'carol: uploaded_by cannot be supplied, not even as someone else (column grant)');

-- ---------------------------------------------------------------------------
-- Member: insert and delete own; not another member's
-- ---------------------------------------------------------------------------
select lives_ok(
  format($sql$select tests.remember_text('att_c', tests.create_attachment(%L, 'notes.txt', p_size => 123)::text)$sql$, tests.rec_a1()),
  'carol (member): inserts an attachment on a record in A');
select is((select uploaded_by from public.attachments where id = tests.recall_text('att_c')::uuid), tests.carol(),
  'carol: uploaded_by defaults to the caller');
select is((select count(*)::int from public.attachments where record_id = tests.rec_a1()), 2,
  'carol: sees both attachments of the record (alice''s and hers)');
select is(tests.rows_affected(format($sql$delete from public.attachments where id = %L$sql$, tests.recall_text('att_a'))),
  0, 'carol (member): delete of alice''s attachment affects 0 rows');
select lives_ok(
  format($sql$select tests.remember_text('att_c2', tests.create_attachment(%L, 'second.txt')::text)$sql$, tests.rec_a1()),
  'carol: inserts a second attachment');
select is(tests.rows_affected(format($sql$delete from public.attachments where id = %L$sql$, tests.recall_text('att_c'))),
  1, 'carol (member): delete of her own attachment affects 1 row');

select tests.login_as(tests.dave());
select is(tests.rows_affected(format($sql$delete from public.attachments where id = %L$sql$, tests.recall_text('att_c2'))),
  1, 'dave (admin): delete of carol''s attachment affects 1 row');

select tests.login_as(tests.carol());
select lives_ok(
  format($sql$select tests.remember_text('att_c3', tests.create_attachment(%L, 'third.txt')::text)$sql$, tests.rec_a1()),
  'carol: inserts a third attachment');
select tests.login_as(tests.alice());
select is(tests.rows_affected(format($sql$delete from public.attachments where id = %L$sql$, tests.recall_text('att_c3'))),
  1, 'alice (owner): delete of carol''s attachment affects 1 row');

-- ---------------------------------------------------------------------------
-- Checks (as alice in A)
-- ---------------------------------------------------------------------------
select throws_ok(format($sql$select tests.create_attachment(%L, 'a/b.txt')$sql$, tests.rec_a2()),
  '23514', null, 'file name with / is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, 'a\b.txt')$sql$, tests.rec_a2()),
  '23514', null, 'file name with \ is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, E'a\nb.txt')$sql$, tests.rec_a2()),
  '23514', null, 'file name with a control character is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, '')$sql$, tests.rec_a2()),
  '23514', null, 'empty file name is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, ' padded.txt')$sql$, tests.rec_a2()),
  '23514', null, 'file name with leading whitespace is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, %L)$sql$, tests.rec_a2(), repeat('a', 252) || '.txt'),
  '23514', null, 'file name of 256 characters is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, 'résumé.pdf')$sql$, tests.rec_a2()),
  '23514', null, 'file name with non-ASCII letters is rejected (not a valid Storage key)');
select throws_ok(format($sql$select tests.create_attachment(%L, 'x.exe', p_content_type => 'application/x-msdownload')$sql$, tests.rec_a2()),
  '23514', null, 'content type outside the allow-list is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, 'x.html', p_content_type => 'text/html')$sql$, tests.rec_a2()),
  '23514', null, 'text/html is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, 'x.txt', p_content_type => 'text/plain; charset=utf-8')$sql$, tests.rec_a2()),
  '23514', null, 'content type with parameters is rejected (store the bare type)');
select throws_ok(format($sql$select tests.create_attachment(%L, 'empty.txt', p_size => 0)$sql$, tests.rec_a2()),
  '23514', null, 'size 0 is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, 'big.zip', p_size => 10485761, p_content_type => 'application/zip')$sql$, tests.rec_a2()),
  '23514', null, 'size over 10 MB is rejected');
select lives_ok(format($sql$select tests.create_attachment(%L, %L, p_size => 10485760, p_content_type => %L)$sql$,
                       tests.rec_a2(), repeat('b', 250) || '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  'a 255-character name, exactly 10 MB, xlsx is accepted');
select lives_ok(format($sql$select tests.create_attachment(%L, 'Scan (1) & co, v2.pdf', p_content_type => 'application/pdf')$sql$, tests.rec_a2()),
  'a name with spaces, parentheses, ampersand and comma is accepted');

-- Cap: rec_a2 now has 2; 8 more make 10; the 11th fails.
select lives_ok(
  format($sql$select tests.create_attachment(%L, 'file-' || g || '.txt') from generate_series(1, 8) g$sql$, tests.rec_a2()),
  'alice: attachments 3 to 10 on one record are accepted');
select throws_ok(format($sql$select tests.create_attachment(%L, 'eleventh.txt')$sql$, tests.rec_a2()),
  '23514', 'attachments: at most 10 files per record',
  'the 11th attachment on a record is rejected');
select is((select count(*)::int from public.attachments where record_id = tests.rec_a2()), 10,
  'the record keeps exactly 10 attachments');

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
select tests.logout();
select is(
  (select metadata from public.audit_events
   where action = 'attachment.added' and entity_id = tests.recall_text('att_c') and actor_id = tests.carol()),
  jsonb_build_object('record_id', tests.rec_a1(), 'file_name', 'notes.txt', 'size_bytes', 123),
  'attachment.added by carol with exactly { record_id, file_name, size_bytes }');
select is(
  (select entity_type from public.audit_events where action = 'attachment.added' and entity_id = tests.recall_text('att_c')),
  'attachment', 'attachment.added has entity_type attachment');
select is(
  (select metadata from public.audit_events
   where action = 'attachment.removed' and entity_id = tests.recall_text('att_c') and actor_id = tests.carol()),
  jsonb_build_object('record_id', tests.rec_a1(), 'file_name', 'notes.txt', 'size_bytes', 123),
  'attachment.removed by carol for her own delete');
select is(
  (select count(*)::int from public.audit_events
   where action = 'attachment.removed' and entity_id = tests.recall_text('att_c2') and actor_id = tests.dave()),
  1, 'attachment.removed by dave (admin) for carol''s file');
select is_empty(
  $sql$select 1 from public.audit_events
       where action like 'attachment.%' and created_at >= now()
         and (metadata - 'record_id' - 'file_name' - 'size_bytes') <> '{}'::jsonb$sql$,
  'no attachment audit row carries anything beyond record_id, file_name, size_bytes (no path, type or content)');

-- ---------------------------------------------------------------------------
-- Cleanup queue
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.storage_deletion_queue
   where bucket_id = 'attachments' and workspace_id = tests.ws_a()
     and object_name like tests.ws_a()::text || '/' || tests.rec_a1()::text || '/' || tests.recall_text('att_c') || '-notes.txt'),
  1, 'a direct delete enqueued the object (bucket attachments, exact path)');

select tests.remember_text('path_a', tests.path_of(tests.recall_text('att_a')::uuid));
select tests.login_as(tests.alice());
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_a1())),
  1, 'alice: deletes record A1');
select tests.logout();
select is((select count(*)::int from public.attachments where record_id = tests.rec_a1()), 0,
  'record delete cascaded its attachments');
select is((select count(*)::int from public.storage_deletion_queue where object_name = tests.recall_text('path_a')), 1,
  'the cascaded attachment''s object is enqueued');
select is((select count(*)::int from public.audit_events
           where action = 'attachment.removed' and entity_id = tests.recall_text('att_a')), 0,
  'a cascaded attachment delete is not audited per file');

select tests.login_as(tests.alice());
select throws_ok('select * from public.storage_deletion_queue', '42501',
  'permission denied for table storage_deletion_queue',
  'alice: the deletion queue is not readable');
select throws_ok($sql$insert into public.storage_deletion_queue (bucket_id, object_name, workspace_id) values ('attachments', 'x', gen_random_uuid())$sql$,
  '42501', 'permission denied for table storage_deletion_queue',
  'alice: cannot write to the deletion queue');

-- Workspace cascade: carol creates her own workspace with one attachment and deletes it.
select tests.login_as(tests.carol());
insert into public.workspaces (id, name, slug, created_by)
values ('00000000-0000-0000-0000-00000000c0c1', 'Carol WS', 'carol-ws-attachments-test', tests.carol());
insert into public.modules (id, workspace_id, name, slug)
values ('00000000-0000-0000-0000-00000000c0c2', '00000000-0000-0000-0000-00000000c0c1', 'Docs', 'docs');
insert into public.records (id, workspace_id, module_id, title)
values ('00000000-0000-0000-0000-00000000c0c3', '00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-00000000c0c2', 'Doc');
select tests.create_attachment('00000000-0000-0000-0000-00000000c0c3', 'one.txt', p_size => 100);
select tests.create_attachment('00000000-0000-0000-0000-00000000c0c3', 'two.png', p_size => 250, p_content_type => 'image/png');

select results_eq(
  $sql$select modules, records, members, attachments, storage_bytes from public.workspace_usage('00000000-0000-0000-0000-00000000c0c1')$sql$,
  $sql$values (1, 1, 1, 2, 0::bigint)$sql$,
  'workspace_usage counts pending attachments, but storage_bytes only sums uploaded ones (migration 006)');
select is(tests.rows_affected($sql$delete from public.workspaces where id = '00000000-0000-0000-0000-00000000c0c1'$sql$),
  1, 'carol: deletes her workspace');
select tests.logout();
select is((select count(*)::int from public.storage_deletion_queue where workspace_id = '00000000-0000-0000-0000-00000000c0c1'), 2,
  'a workspace delete enqueues every attachment object, and the entries survive the workspace');

-- workspace_usage on a seed workspace: a delta against the start of the file.
-- Mark record A2's rows as uploaded (what reconcile_attachment_object does).
update public.attachments set uploaded_at = now() where record_id = tests.rec_a2();
select tests.login_as(tests.alice());
select ok(
  (select attachments >= 10 and storage_bytes >= 10485760 from public.workspace_usage(tests.ws_a())),
  'alice: workspace_usage(A) includes the 10 attachments of record A2 (>= 10 MB)');

select * from finish();
rollback;
