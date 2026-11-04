-- 21: Phase 3 review fixes (migration 006).
--   * L3: id is not insertable on modules, field_definitions, records
--   * C4: search document (whole, @-split, alphanumeric parts) and the
--     tokenizer's queries for 12500.5, 12500, acme, jane@acme.example,
--     example.com, -5, café, ACME
--   * C3: update_record() precondition (PT409 record_changed, PT404
--     not_found), set/unset/status semantics, validation, malformed patches
--   * C5: record.deleted with { module_id, title, attachment_count }; not for
--     module cascades
--   * M3 / L6 / L7 / L4: number range, blank strings, nested values, settings
--     and options size
--   * concurrency: module locks in the triggers, app.field_strip flag; blank
--     values in the type and option guards
--   * file names without ? # %
--   * H1 / L5: reconciliation of superuser (signed-URL) uploads, uploaded_at,
--     storage_bytes, cap with stale pending rows, sweep_stale_attachments()
--   * scheduling helpers and indexes
create extension if not exists pgtap with schema extensions;

begin;
select plan(96);
\ir helpers/tests_schema.sql.inc

-- The include grants insert (id) for its fixture helpers; this file asserts
-- the real grants of migration 006, so take it back first.
revoke insert (id) on table public.modules, public.field_definitions, public.records from authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Member');
insert into public.workspace_members (workspace_id, user_id, role) values (tests.ws_a(), tests.carol(), 'member');

select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_module(tests.mod_b(), tests.ws_b(), 'test-module-b');
select tests.create_field(tests.fld_a1(), tests.mod_a(), 'email',  'text',   p_position => 0);
select tests.create_field(tests.fld_a2(), tests.mod_a(), 'amount', 'number', p_position => 1);
select tests.create_field(tests.fld_a3(), tests.mod_a(), 'city',   'text',   p_position => 2);
select tests.create_field(tests.fld_a4(), tests.mod_a(), 'price',  'currency', p_position => 3);
select tests.create_field(tests.fld_a5(), tests.mod_a(), 'stage',  'select', p_position => 4,
  p_options => '[{"value": "new", "label": "New"}, {"value": "won", "label": "Won"}]');

select tests.create_record(tests.rec_a1(), tests.mod_a(), 'Acme Ltd', '{"email": "jane@acme.example", "amount": 12500.5}');
select tests.create_record(tests.rec_a2(), tests.mod_a(), 'Globex', '{"email": "ops@example.com", "amount": -5}');
select tests.create_record(tests.rec_a3(), tests.mod_a(), 'Café Central', '{"city": "Wien"}');
select tests.create_record(tests.rec_b1(), tests.mod_b(), 'Record B1');

-- ---------------------------------------------------------------------------
-- L3: no client-chosen ids
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select throws_ok(
  format($sql$insert into public.records (id, workspace_id, module_id, title) values (gen_random_uuid(), %L, %L, 'x')$sql$, tests.ws_a(), tests.mod_a()),
  '42501', 'permission denied for table records', 'alice: records.id cannot be supplied');
select throws_ok(
  format($sql$insert into public.modules (id, workspace_id, name, slug) values (gen_random_uuid(), %L, 'X', 'x-id-test')$sql$, tests.ws_a()),
  '42501', 'permission denied for table modules', 'alice: modules.id cannot be supplied');
select throws_ok(
  format($sql$insert into public.field_definitions (id, workspace_id, module_id, key, label, type) values (gen_random_uuid(), %L, %L, 'k', 'K', 'text')$sql$, tests.ws_a(), tests.mod_a()),
  '42501', 'permission denied for table field_definitions', 'alice: field_definitions.id cannot be supplied');
select is(tests.rows_affected(format($sql$insert into public.records (workspace_id, module_id, title) values (%L, %L, 'Generated id')$sql$, tests.ws_a(), tests.mod_a())),
  1, 'alice: a record insert without id succeeds (id generated)');

-- ---------------------------------------------------------------------------
-- C4: search document and tokenizer queries
-- ---------------------------------------------------------------------------
select ok(
  tsvector_to_array(public.record_search_document('', '', '{"e": "jane@acme.example"}')) @> array['jane@acme.example', 'jane', 'acme', 'example', 'acme.example'],
  'document: an email is indexed whole, its domain as a host, and split into jane, acme, example');
select ok(
  tsvector_to_array(public.record_search_document('', '', '{"n": 12500.5}')) @> array['12500.5', '12500', '5'],
  'document: 12500.5 is indexed as 12500.5, 12500 and 5');
select ok(
  tsvector_to_array(public.record_search_document('Foo-Bar', null, null)) @> array['foo-bar', 'foo', 'bar'],
  'document: title, null status and null values are accepted; hyphenated words whole and split');

-- Query strings exactly as the C4 tokenizer builds them (input -> tsquery).
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', '12500.5:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "12500.5" -> 12500.5:* finds the decimal value');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', '12500:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "12500" -> 12500:* finds 12500.5');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'acme:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "acme" -> acme:* finds the record (title and email jane@acme.example)');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'jane:*') and title = 'Acme Ltd'$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "jane" -> jane:* finds the local part of the email');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'jane@acme.example:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "jane@acme.example" -> jane@acme.example:* finds the whole email');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'jane@acme:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "jane@acme" (typing in progress) still finds the email');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'example.com:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a2()),
  'search "example.com" -> example.com:* finds ops@example.com (domain indexed as a host)');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', '5:*') order by title$sql$, tests.mod_a()),
  format($sql$values (%L::uuid), (%L::uuid)$sql$, tests.rec_a1(), tests.rec_a2()),
  'search "-5" -> 5:* (leading - stripped) finds -5 and the 5 of 12500.5');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'café:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a3()),
  'search "café" -> café:* finds the accented title');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'acme:*')$sql$, tests.mod_a()),
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'ACME:*')$sql$, tests.mod_a()),
  'search "ACME" -> acme:* (lowercased) matches exactly what ACME:* matches');
select results_eq(
  format($sql$select id from public.records where module_id = %L and search_vector @@ to_tsquery('simple', 'acme:* & 12500.5:*')$sql$, tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'search "acme 12500.5" -> acme:* & 12500.5:* needs both tokens');
select is((select count(*)::int from public.records where module_id = tests.mod_a() and search_vector @@ to_tsquery('simple', 'acme:* & wien:*')), 0,
  'tokens are ANDed: no record has both acme and wien');

-- ---------------------------------------------------------------------------
-- C3: update_record
-- ---------------------------------------------------------------------------
select tests.logout();
-- Fixture with a known past updated_at (insert does not fire set_updated_at).
insert into public.records (id, workspace_id, module_id, title, status, custom_values, created_by, updated_at)
values ('00000000-0000-0000-0000-00000000c0e4', tests.ws_a(), tests.mod_a(), 'Versioned', 'open',
        '{"email": "v@example.com", "city": "Graz"}', tests.alice(), '2026-11-01T10:00:00.123456+00');

select tests.login_as(tests.alice());
select is(
  (select title || '|' || status || '|' || (updated_at = now())::text
   from public.update_record('00000000-0000-0000-0000-00000000c0e4', '2026-11-01T10:00:00.123456+00', '{"title": "Versioned v2"}')),
  'Versioned v2|open|true',
  'update_record: matching updated_at applies the title, keeps status, stamps updated_at');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', '2026-11-01T10:00:00.123456+00', '{"title": "Lost update"}')$sql$,
  'PT409', 'record_changed',
  'update_record: a second update with the same expected updated_at gets PT409 record_changed');
select is((select title from public.records where id = '00000000-0000-0000-0000-00000000c0e4'), 'Versioned v2',
  'update_record: the losing update changed nothing');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', '2026-11-01T10:00:00.123457+00', '{}')$sql$,
  'PT409', 'record_changed',
  'update_record: the precondition compares microseconds (pass updated_at exactly as read)');
select throws_ok(
  $sql$select * from public.update_record(gen_random_uuid(), now(), '{"title": "x"}')$sql$,
  'PT404', 'not_found',
  'update_record: an unknown id gets PT404 not_found');
select is(
  (select custom_values from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(),
     '{"set": {"amount": 7, "city": "Linz"}, "unset": ["email"], "status": null}')),
  '{"amount": 7, "city": "Linz"}'::jsonb,
  'update_record: set merges, unset removes keys, set wins over existing values');
select is((select status from public.records where id = '00000000-0000-0000-0000-00000000c0e4'), null,
  'update_record: "status": null clears the status');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(), '{"set": {"stage": "lost"}}')$sql$,
  '23514', 'custom_values.stage: not one of the options',
  'update_record: the validation trigger runs on the merged value (23514 contract unchanged)');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(), '{"title": "   "}')$sql$,
  '23514', null,
  'update_record: a blank title fails records_title_not_blank_check');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(), '{"custom_values": {}}')$sql$,
  '22023', 'p_patch.custom_values: unknown key',
  'update_record: unknown patch keys are rejected with 22023');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(), '{"unset": "email"}')$sql$,
  '22023', 'p_patch.unset: expected array of strings',
  'update_record: unset must be an array of strings');
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(), '{"title": 5}')$sql$,
  '22023', 'p_patch.title: expected string',
  'update_record: title must be a string');

-- A title-only patch does not run the custom value validation (stale record).
select tests.logout();
update public.field_definitions set required = true where id = tests.fld_a3();
update public.records set updated_at = updated_at where id = tests.rec_a1();
select tests.login_as(tests.alice());
select is(
  (select title from public.update_record(tests.rec_a1(), (select updated_at from public.records where id = tests.rec_a1()), '{"title": "Acme Ltd."}')),
  'Acme Ltd.',
  'update_record: a title-only patch of a stale record (required city missing) succeeds');
select throws_ok(
  format($sql$select * from public.update_record(%L, now(), '{"set": {"amount": 1}}')$sql$, tests.rec_a1()),
  '23514', 'custom_values.city: required',
  'update_record: a values patch of the stale record reports the missing required field');
select tests.logout();
update public.field_definitions set required = false where id = tests.fld_a3();

select tests.login_as(tests.bob());
select throws_ok(
  $sql$select * from public.update_record('00000000-0000-0000-0000-00000000c0e4', now(), '{"title": "Pwned"}')$sql$,
  'PT404', 'not_found',
  'bob: update_record on a record of A gets the same PT404 not_found as an unknown id');
select tests.logout();
select is((select title from public.records where id = '00000000-0000-0000-0000-00000000c0e4'), 'Versioned v2',
  'postgres: bob changed nothing');

-- ---------------------------------------------------------------------------
-- M3 / L6 / L7 / L4
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select throws_ok(
  format($sql$update public.records set custom_values = '{"amount": 1e15}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.amount: number out of range', 'number: 1e15 is out of range');
select throws_ok(
  format($sql$update public.records set custom_values = '{"amount": -1000000000000000}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.amount: number out of range', 'number: -1e15 is out of range');
select throws_ok(
  format($sql$update public.records set custom_values = '{"amount": 1.1234567}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.amount: number out of range', 'number: 7 fractional digits are out of range');
select throws_ok(
  format($sql$update public.records set custom_values = '{"price": 1e-7}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.price: number out of range', 'currency: 1e-7 (7 fractional digits) is out of range');
select is(tests.rows_affected(format($sql$update public.records set custom_values = '{"amount": 999999999999999.5, "price": 1.1234560}' where id = %L$sql$, tests.rec_a3())),
  1, 'number: 999999999999999.5 and 1.1234560 (6 significant decimals) are accepted');

select tests.logout();
update public.field_definitions set required = true where id = tests.fld_a3();
select tests.login_as(tests.alice());
select throws_ok(
  format($sql$update public.records set custom_values = '{"city": "   "}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.city: required', 'required: a whitespace-only string is empty');
select throws_ok(
  format($sql$update public.records set custom_values = %L where id = %L$sql$, jsonb_build_object('city', E' 　\t'), tests.rec_a3()),
  '23514', 'custom_values.city: required', 'required: NBSP, ideographic space and tab only is empty');
select tests.logout();
update public.field_definitions set required = false where id = tests.fld_a3();
select tests.login_as(tests.alice());

select throws_ok(
  format($sql$update public.records set title = '   ' where id = %L$sql$, tests.rec_a3()),
  '23514', 'new row for relation "records" violates check constraint "records_title_not_blank_check"',
  'title: whitespace only is rejected');
select throws_ok(
  format($sql$update public.records set title = %L where id = %L$sql$, E'　', tests.rec_a3()),
  '23514', 'new row for relation "records" violates check constraint "records_title_not_blank_check"',
  'title: an ideographic space only is rejected');
select is(tests.rows_affected(format($sql$update public.records set title = ' Café Central ' where id = %L$sql$, tests.rec_a3())),
  1, 'title: surrounding whitespace around text is still accepted (the client trims)');

select throws_ok(
  format($sql$update public.records set custom_values = '{"city": ["Wien"]}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.city: nested objects and arrays are not allowed', 'nested: an array value is rejected');
select throws_ok(
  format($sql$update public.records set custom_values = '{"city": {"name": "Wien"}}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.city: nested objects and arrays are not allowed', 'nested: an object value is rejected');
select throws_ok(
  format($sql$update public.records set custom_values = '{"bogus": [[[[1]]]]}' where id = %L$sql$, tests.rec_a3()),
  '23514', 'custom_values.bogus: nested objects and arrays are not allowed', 'nested: reported before the unknown-key check');

select throws_ok(
  format($sql$insert into public.field_definitions (workspace_id, module_id, key, label, type, settings) values (%L, %L, 'big_settings', 'Big', 'text', %L)$sql$,
         tests.ws_a(), tests.mod_a(), jsonb_build_object('note', repeat('x', 3000))),
  '23514', 'new row for relation "field_definitions" violates check constraint "field_definitions_settings_size_check"',
  'settings larger than 2048 bytes are rejected');
select throws_ok(
  format($sql$insert into public.field_definitions (workspace_id, module_id, key, label, type, options) values (%L, %L, 'big_options', 'Big', 'select', %L)$sql$,
         tests.ws_a(), tests.mod_a(),
         (select jsonb_agg(jsonb_build_object('value', g::text || repeat('€', 95), 'label', repeat('€', 100)))
          from generate_series(1, 100) g)),
  '23514', 'new row for relation "field_definitions" violates check constraint "field_definitions_options_size_check"',
  'options larger than 32768 bytes are rejected');

-- ---------------------------------------------------------------------------
-- Guards ignore blank values; the strip flag; module locks
-- ---------------------------------------------------------------------------
select tests.logout();
update public.records set custom_values = custom_values - 'city' where id = '00000000-0000-0000-0000-00000000c0e4';
update public.records set custom_values = custom_values || '{"city": ""}' where id = tests.rec_a2();
update public.records set custom_values = custom_values || '{"stage": "  "}' where id = tests.rec_a1();
select tests.login_as(tests.alice());
select lives_ok(
  format($sql$update public.field_definitions set type = 'date' where id = %L$sql$, tests.fld_a3()),
  'type guard: a field whose only values are blank strings can change type');
select lives_ok(
  format($sql$update public.field_definitions set options = '[{"value": "won", "label": "Won"}]' where id = %L$sql$, tests.fld_a5()),
  'option guard: a blank stored value does not count as a use of an option');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a3())),
  1, 'field delete strips the key (validation skipped through app.field_strip)');
select is(current_setting('app.field_strip', true), 'off',
  'app.field_strip is off again after the strip update');
select ok(not (tests.values_of(tests.rec_a2()) ? 'city'), 'the deleted key is gone from the record');
select tests.logout();
select ok(pg_get_functiondef('public.validate_record_custom_values()'::regprocedure) !~ 'pg_trigger_depth',
  'validate_record_custom_values no longer skips on pg_trigger_depth()');
select ok(pg_get_functiondef('public.validate_record_custom_values()'::regprocedure) ~* 'for share',
  'validate_record_custom_values locks the module row FOR SHARE');
select ok(pg_get_functiondef('public.protect_field_definition()'::regprocedure) ~* 'for update'
          and pg_get_functiondef('public.handle_field_deleted()'::regprocedure) ~* 'for update',
  'protect_field_definition and handle_field_deleted lock the module row FOR UPDATE');

-- ---------------------------------------------------------------------------
-- C5: record.deleted
-- ---------------------------------------------------------------------------
select tests.remember_text('att_r1', tests.create_attachment(tests.rec_a2(), 'one.txt', tests.alice())::text);
select tests.create_attachment(tests.rec_a2(), 'two.txt', tests.carol());
select tests.login_as(tests.carol());
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_a2())),
  1, 'carol (member): deletes a record with two attachments');
select tests.logout();
select is(
  (select metadata from public.audit_events where action = 'record.deleted' and entity_id = tests.rec_a2()::text),
  jsonb_build_object('module_id', tests.mod_a(), 'title', 'Globex', 'attachment_count', 2),
  'record.deleted has exactly { module_id, title, attachment_count }');
select is(
  (select actor_id::text || '|' || entity_type || '|' || workspace_id::text from public.audit_events
   where action = 'record.deleted' and entity_id = tests.rec_a2()::text),
  tests.carol()::text || '|record|' || tests.ws_a()::text,
  'record.deleted: actor is the caller, entity_type record, workspace A');
select is((select count(*)::int from public.audit_events where action = 'attachment.removed' and entity_id = tests.recall_text('att_r1')), 0,
  'the cascaded attachments are not audited one by one');
select is((select count(*)::int from public.storage_deletion_queue where object_name like tests.ws_a()::text || '/' || tests.rec_a2()::text || '/%'), 2,
  'the cascaded attachments are queued');

select tests.create_module('00000000-0000-0000-0000-00000000c0a9', tests.ws_a(), 'cascade-module');
select tests.create_record('00000000-0000-0000-0000-00000000c0e9', '00000000-0000-0000-0000-00000000c0a9', 'In a doomed module');
select tests.login_as(tests.alice());
select is(tests.rows_affected($sql$delete from public.modules where id = '00000000-0000-0000-0000-00000000c0a9'$sql$),
  1, 'alice: deletes a module with a record');
select tests.logout();
select is((select count(*)::int from public.audit_events where action = 'record.deleted' and entity_id = '00000000-0000-0000-0000-00000000c0e9'), 0,
  'a module cascade writes no record.deleted (module.deleted stands for it)');
select is((select count(*)::int from public.audit_events where action = 'module.deleted' and entity_id = '00000000-0000-0000-0000-00000000c0a9'), 1,
  'the module cascade wrote module.deleted');

-- ---------------------------------------------------------------------------
-- File names: no ? # %
-- ---------------------------------------------------------------------------
select throws_ok(format($sql$select tests.create_attachment(%L, 'what?.txt', %L)$sql$, tests.rec_a1(), tests.alice()),
  '23514', null, 'file name with ? is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, 'no#1.txt', %L)$sql$, tests.rec_a1(), tests.alice()),
  '23514', null, 'file name with # is rejected');
select throws_ok(format($sql$select tests.create_attachment(%L, '100%%.txt', %L)$sql$, tests.rec_a1(), tests.alice()),
  '23514', null, 'file name with %% is rejected');

-- ---------------------------------------------------------------------------
-- H1 / L5: reconciliation of stored objects
-- ---------------------------------------------------------------------------
-- Inserts as postgres stand for storage-api's superuser writes (signed upload
-- URLs, TUS with an upload signature), which bypass the insert policy.
select tests.remember_text('ok_path', tests.path_of(tests.create_attachment(tests.rec_a1(), 'ok.txt', tests.alice(), 5)));
insert into storage.objects (bucket_id, name, metadata) values ('attachments', tests.recall_text('ok_path'), '{"mimetype": "text/plain", "contentLength": 5}');
select is((select uploaded_at from public.attachments where storage_path = tests.recall_text('ok_path')), null,
  'an insert without size (pre-upload check) leaves the row pending');
select tests.allow_storage_delete();
delete from storage.objects where name = tests.recall_text('ok_path');
insert into storage.objects (bucket_id, name, metadata) values ('attachments', tests.recall_text('ok_path'), tests.object_meta(5, 'text/plain; charset=utf-8'));
select isnt((select uploaded_at from public.attachments where storage_path = tests.recall_text('ok_path')), null,
  'a superuser insert with matching size and MIME type stamps uploaded_at');

select tests.remember_text('att_attack', tests.create_attachment(tests.rec_a1(), 'attack.txt', tests.carol(), 1)::text);
select tests.remember_text('attack_path', tests.path_of(tests.recall_text('att_attack')::uuid));
insert into storage.objects (bucket_id, name, metadata)
values ('attachments', tests.recall_text('attack_path'), tests.object_meta(10485760, 'application/zip'));
select is((select count(*)::int from public.attachments where id = tests.recall_text('att_attack')::uuid), 0,
  'signed-upload attack (row text/plain 1 byte, object 10 MiB zip): the row is deleted');
select is((select count(*)::int from public.storage_deletion_queue where object_name = tests.recall_text('attack_path')), 1,
  'signed-upload attack: the object is queued for purge-attachments');
select is(
  (select metadata from public.audit_events where action = 'attachment.rejected' and entity_id = tests.recall_text('att_attack')),
  jsonb_build_object('record_id', tests.rec_a1(), 'file_name', 'attack.txt', 'size_bytes', 1,
                     'object_size_bytes', 10485760, 'object_content_type', 'application/zip', 'reason', 'size_mismatch'),
  'signed-upload attack: attachment.rejected with declared and stored size/type and the reason');
select is((select actor_id from public.audit_events where action = 'attachment.rejected' and entity_id = tests.recall_text('att_attack')), tests.carol(),
  'attachment.rejected: the actor is the uploader of the row');
select is((select count(*)::int from public.audit_events where action = 'attachment.removed' and entity_id = tests.recall_text('att_attack')), 0,
  'a rejection is not also logged as attachment.removed');

select tests.remember_text('att_type', tests.create_attachment(tests.rec_a1(), 'type.txt', tests.alice(), 64)::text);
insert into storage.objects (bucket_id, name, metadata)
values ('attachments', tests.path_of(tests.recall_text('att_type')::uuid), tests.object_meta(64, 'application/zip'));
select is((select metadata ->> 'reason' from public.audit_events where action = 'attachment.rejected' and entity_id = tests.recall_text('att_type')),
  'content_type_mismatch', 'a stored MIME type that differs from content_type is rejected');

select tests.remember_text('norow_path', tests.ws_a()::text || '/' || tests.rec_a1()::text || '/' || gen_random_uuid()::text || '-norow.txt');
insert into storage.objects (bucket_id, name, metadata) values ('attachments', tests.recall_text('norow_path'), tests.object_meta(3));
select is((select workspace_id from public.storage_deletion_queue where object_name = tests.recall_text('norow_path')), tests.ws_a(),
  'an object without a row is queued under the workspace of its path');

-- Cap: 10 uploaded files; a stale pending row cannot become the 11th.
insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes, uploaded_by, created_at)
values (tests.ws_a(), tests.rec_a3(), 'stale.txt', 'text/plain', 7, tests.alice(), now() - interval '2 hours');
select tests.remember_text('stale_path', (select storage_path from public.attachments where record_id = tests.rec_a3() and file_name = 'stale.txt'));
select lives_ok(
  format($sql$select tests.create_attachment(%L, 'cap-' || g || '.txt', %L) from generate_series(1, 10) g$sql$, tests.rec_a3(), tests.alice()),
  'a stale pending row does not count toward the cap: 10 fresh rows fit next to it');
select throws_ok(format($sql$select tests.create_attachment(%L, 'eleventh.txt', %L)$sql$, tests.rec_a3(), tests.alice()),
  '23514', 'attachments: at most 10 files per record', 'the cap still counts in-flight (pending, recent) rows');
update public.attachments set uploaded_at = now() where record_id = tests.rec_a3() and file_name like 'cap-%';

select tests.login_as(tests.alice());
select ok(not public.can_upload_attachment_object(tests.recall_text('stale_path'), tests.object_meta(7)),
  'alice: the upload policy refuses a pending row older than one hour');
select results_eq(
  format($sql$select storage_bytes >= 1000 and storage_bytes = (select coalesce(sum(size_bytes), 0) from public.attachments where workspace_id = %L and uploaded_at is not null) from public.workspace_usage(%L)$sql$, tests.ws_a(), tests.ws_a()),
  $sql$values (true)$sql$,
  'workspace_usage.storage_bytes sums uploaded rows only');
select tests.logout();

insert into storage.objects (bucket_id, name, metadata) values ('attachments', tests.recall_text('stale_path'), tests.object_meta(7));
select is((select metadata ->> 'reason' from public.audit_events where action = 'attachment.rejected' and metadata ->> 'file_name' = 'stale.txt' and created_at >= now()),
  'too_many_files', 'a superuser upload for an 11th file on a full record is rejected (too_many_files)');

-- sweep_stale_attachments
insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes, uploaded_by, created_at)
values (tests.ws_a(), tests.rec_a1(), 'stale-sweep.txt', 'text/plain', 9, tests.alice(), now() - interval '61 minutes');
select tests.create_attachment(tests.rec_a1(), 'fresh-pending.txt', tests.alice());
select tests.remember_count('stale', (select count(*) from public.attachments where uploaded_at is null and created_at < now() - interval '1 hour'));
select is(public.sweep_stale_attachments(), greatest(tests.recall_count('stale'), 1),
  'sweep_stale_attachments removes exactly the pending rows older than one hour (at least the fixture)');
select is((select count(*)::int from public.attachments where record_id = tests.rec_a1() and file_name = 'stale-sweep.txt'), 0,
  'the stale row is gone');
select is((select count(*)::int from public.attachments where record_id = tests.rec_a1() and file_name = 'fresh-pending.txt'), 1,
  'recent pending rows are kept');

-- ---------------------------------------------------------------------------
-- Scheduling helpers, indexes, helpers
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_cron and pg_net are installed');
select is((select schedule from cron.job where jobname = 'sweep-stale-attachments'), '5-59/10 * * * *',
  'the sweep job runs every 10 minutes at :05');
select is((select count(*)::int from cron.job where jobname = 'purge-attachments'
           and not exists (select 1 from vault.secrets where name = 'purge_attachments_service_key')), 0,
  'no purge job exists while the vault secret is missing');
select vault.create_secret('test-only-not-a-key', 'purge_attachments_service_key');
select vault.create_secret('http://kong:8000/functions/v1/purge-attachments', 'purge_attachments_url');
select is(public.schedule_storage_maintenance(), 'scheduled: sweep-stale-attachments, purge-attachments',
  'schedule_storage_maintenance creates the purge job once both secrets exist');
select is((select schedule || ' ' || command from cron.job where jobname = 'purge-attachments'),
  '*/10 * * * * select public.invoke_purge_attachments()',
  'the purge job runs every 10 minutes and holds no key (it reads Vault at run time)');

select has_index('public', 'records', 'records_workspace_module_updated_idx',
  array['workspace_id', 'module_id', 'updated_at', 'id'],
  'default sort index (workspace_id, module_id, updated_at desc, id) exists');
select ok(public.text_is_blank(E' \t\n  　﻿') and public.text_is_blank('') and public.text_is_blank(null)
          and not public.text_is_blank(' a '),
  'text_is_blank covers the JavaScript trim() whitespace set');

select tests.login_as(tests.alice());
select throws_ok($sql$select public.sweep_stale_attachments()$sql$, '42501', 'permission denied for function sweep_stale_attachments',
  'alice: cannot run sweep_stale_attachments');
select throws_ok($sql$select public.schedule_storage_maintenance()$sql$, '42501', 'permission denied for function schedule_storage_maintenance',
  'alice: cannot run schedule_storage_maintenance');
select throws_ok($sql$select public.invoke_purge_attachments()$sql$, '42501', 'permission denied for function invoke_purge_attachments',
  'alice: cannot run invoke_purge_attachments');
select tests.logout();

select * from finish();
rollback;
