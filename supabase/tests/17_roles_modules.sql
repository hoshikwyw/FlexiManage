-- 17: role rules and audit for modules, field_definitions and records
-- (migration 004).
--   * member: reads modules, fields and records; cannot create, update or
--     delete modules or fields; can create, update and delete records (MVP
--     rule, including records created by someone else)
--   * admin and owner: everything, including module and field writes
--   * column grants: search_vector is not writable; workspace_id and module_id
--     are not updatable; created_at/updated_at are never supplied; created_by
--     must be the caller
--   * audit: module.created, module.updated (name/slug only), module.deleted,
--     field.created, field.deleted; nothing for records
-- Fixtures (as postgres): carol admin of A, dave member of A; module
-- tests.mod_a with one field and one record created by alice.
create extension if not exists pgtap with schema extensions;

begin;
select plan(61);
\ir helpers/tests_schema.sql.inc

create function tests.mod_a2() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0a2'::uuid $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
select tests.create_user(tests.dave(),  'dave@example.com',  'Dave Example');
insert into public.workspace_members (workspace_id, user_id, role) values
  (tests.ws_a(), tests.carol(), 'admin'),
  (tests.ws_a(), tests.dave(),  'member');

select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_field(tests.fld_a1(), tests.mod_a(), 'company', 'text');
select tests.create_record(tests.rec_a1(), tests.mod_a(), 'Made by alice', '{"company": "Zebrafish Ltd"}');

-- ---------------------------------------------------------------------------
-- dave (member)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.dave());

select is((select count(*)::int from public.modules where id = tests.mod_a()), 1, 'member: reads the module');
select is((select count(*)::int from public.field_definitions where module_id = tests.mod_a()), 1, 'member: reads the fields');
select is((select count(*)::int from public.records where module_id = tests.mod_a()), 1, 'member: reads the records');

select throws_ok(
  format($sql$select tests.create_module(%L, %L, 'by-member', %L)$sql$, tests.mod_a2(), tests.ws_a(), tests.dave()),
  '42501', 'new row violates row-level security policy for table "modules"',
  'member: cannot create a module');
select is(tests.rows_affected(format($sql$update public.modules set name = 'x' where id = %L$sql$, tests.mod_a())),
  0, 'member: cannot rename a module');
select is(tests.rows_affected(format($sql$update public.modules set position = 5 where id = %L$sql$, tests.mod_a())),
  0, 'member: cannot reorder a module');
select is(tests.rows_affected(format($sql$delete from public.modules where id = %L$sql$, tests.mod_a())),
  0, 'member: cannot delete a module');

select throws_ok(
  format($sql$select tests.create_field(%L, %L, 'notes', 'text')$sql$, tests.fld_a2(), tests.mod_a()),
  '42501', 'new row violates row-level security policy for table "field_definitions"',
  'member: cannot create a field');
select is(tests.rows_affected(format($sql$update public.field_definitions set label = 'x' where id = %L$sql$, tests.fld_a1())),
  0, 'member: cannot update a field');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a1())),
  0, 'member: cannot delete a field');

select lives_ok(
  format($sql$select tests.create_record(%L, %L, 'Made by dave', '{"company": "Yak Inc"}', p_created_by => %L)$sql$,
         tests.rec_a2(), tests.mod_a(), tests.dave()),
  'member: creates a record');
select is(tests.rows_affected(format($sql$update public.records set title = 'Edited by dave', status = 'open' where id = %L$sql$, tests.rec_a1())),
  1, 'member: updates a record created by someone else');
select is(tests.rows_affected(format($sql$update public.records set custom_values = '{"company": "Zebrafish Ltd (dave)"}' where id = %L$sql$, tests.rec_a1())),
  1, 'member: updates custom_values');
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_a1())),
  1, 'member: deletes a record created by someone else (MVP rule)');

-- created_by must be the caller; the default is auth.uid()
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'Forged', '{}', p_created_by => %L)$sql$, tests.rec_a3(), tests.mod_a(), tests.alice()),
  '42501', null,
  'member: cannot create a record with someone else as created_by');
select is(tests.rows_affected(format($sql$insert into public.records (id, workspace_id, module_id, title) values (%L, %L, %L, 'Default author')$sql$,
                                     tests.rec_a3(), tests.ws_a(), tests.mod_a())),
  1, 'member: created_by defaults to the caller');
select is((select created_by from public.records where id = tests.rec_a3()), tests.dave(),
  'member: the default created_by is auth.uid()');

-- column grants on records. search_vector is a generated column: Postgres
-- rejects a value for it (428C9) before the column grant is even consulted
-- (the column is also absent from the insert/update grants).
select throws_ok(
  format($sql$insert into public.records (workspace_id, module_id, title, search_vector) values (%L, %L, 'x', to_tsvector('x'))$sql$,
         tests.ws_a(), tests.mod_a()),
  '428C9', 'cannot insert a non-DEFAULT value into column "search_vector"',
  'member: cannot supply search_vector on insert');
select throws_ok(
  format($sql$update public.records set search_vector = to_tsvector('x') where id = %L$sql$, tests.rec_a2()),
  '428C9', 'column "search_vector" can only be updated to DEFAULT',
  'member: cannot update search_vector');
select column_privs_are('public', 'records', 'search_vector', 'authenticated', array['SELECT'],
  'member: search_vector is read-only in the column grants as well');
select throws_ok(
  format($sql$update public.records set workspace_id = %L where id = %L$sql$, tests.ws_b(), tests.rec_a2()),
  '42501', 'permission denied for table records',
  'member: cannot update records.workspace_id');
select throws_ok(
  format($sql$update public.records set module_id = %L where id = %L$sql$, tests.mod_a(), tests.rec_a2()),
  '42501', 'permission denied for table records',
  'member: cannot update records.module_id');
select throws_ok(
  format($sql$update public.records set created_by = %L where id = %L$sql$, tests.alice(), tests.rec_a2()),
  '42501', 'permission denied for table records',
  'member: cannot update records.created_by');
select throws_ok(
  format($sql$insert into public.records (workspace_id, module_id, title, created_at) values (%L, %L, 'x', now() - interval '1 year')$sql$,
         tests.ws_a(), tests.mod_a()),
  '42501', 'permission denied for table records',
  'member: cannot supply created_at');
select throws_ok(
  format($sql$update public.records set updated_at = now() where id = %L$sql$, tests.rec_a2()),
  '42501', 'permission denied for table records',
  'member: cannot update updated_at');

select tests.logout();
select is((select count(*)::int from public.records where id = tests.rec_a1()), 0, 'postgres: dave''s delete removed alice''s record');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a() and entity_type = 'record'), 0,
  'postgres: record writes produce no audit events');

-- ---------------------------------------------------------------------------
-- carol (admin): module and field writes with audit
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());

select lives_ok(
  format($sql$select tests.create_module(%L, %L, 'by-admin', %L)$sql$, tests.mod_a2(), tests.ws_a(), tests.carol()),
  'admin: creates a module');
select results_eq(
  format($sql$select actor_id, entity_type, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'module.created' and entity_id = %L$sql$, tests.ws_a(), tests.mod_a2()::text),
  format($sql$values (%L::uuid, 'module', %L::text, '{"name": "By Admin", "slug": "by-admin"}'::jsonb)$sql$,
         tests.carol(), tests.mod_a2()),
  'admin: module.created is written with carol as actor and name/slug metadata');

select is(tests.rows_affected(format($sql$update public.modules set name = 'Renamed by admin', slug = 'renamed-by-admin' where id = %L$sql$, tests.mod_a2())),
  1, 'admin: renames the module');
select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
             where workspace_id = %L and action = 'module.updated' and entity_id = %L$sql$, tests.ws_a(), tests.mod_a2()::text),
  format($sql$values (%L::uuid, '{"from": {"name": "By Admin", "slug": "by-admin"}, "to": {"name": "Renamed by admin", "slug": "renamed-by-admin"}}'::jsonb)$sql$,
         tests.carol()),
  'admin: module.updated carries from/to name and slug');
select is(tests.rows_affected(format($sql$update public.modules set position = 3, description = 'desc', icon = 'folder' where id = %L$sql$, tests.mod_a2())),
  1, 'admin: changes position, description and icon');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a() and action = 'module.updated' and entity_id = tests.mod_a2()::text),
  1, 'admin: position/description/icon changes are not audited');

select lives_ok(
  format($sql$select tests.create_field(%L, %L, 'budget', 'currency', p_settings => '{"currency": "EUR"}')$sql$, tests.fld_a2(), tests.mod_a2()),
  'admin: creates a field');
select results_eq(
  format($sql$select actor_id, entity_type, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'field.created' and entity_id = %L$sql$, tests.ws_a(), tests.fld_a2()::text),
  format($sql$values (%L::uuid, 'field_definition', %L::text, jsonb_build_object('module_id', %L::uuid, 'key', 'budget', 'type', 'currency', 'label', 'Budget'))$sql$,
         tests.carol(), tests.fld_a2(), tests.mod_a2()),
  'admin: field.created carries module_id, key, type and label');
select is(tests.rows_affected(format($sql$update public.field_definitions set label = 'Budget (EUR)', required = true, position = 2 where id = %L$sql$, tests.fld_a2())),
  1, 'admin: updates a field');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a() and entity_id = tests.fld_a2()::text),
  1, 'admin: field updates are not audited');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a2())),
  1, 'admin: deletes a field');
select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
             where workspace_id = %L and action = 'field.deleted' and entity_id = %L$sql$, tests.ws_a(), tests.fld_a2()::text),
  format($sql$values (%L::uuid, jsonb_build_object('module_id', %L::uuid, 'key', 'budget', 'type', 'currency', 'label', 'Budget (EUR)'))$sql$,
         tests.carol(), tests.mod_a2()),
  'admin: field.deleted carries module_id, key, type and label');

-- admin on records
select lives_ok(
  format($sql$select tests.create_record(%L, %L, 'Made by carol', '{"company": "Carol Co"}', p_created_by => %L)$sql$,
         tests.rec_a1(), tests.mod_a(), tests.carol()),
  'admin: creates a record');
select is(tests.rows_affected(format($sql$update public.records set title = 'Edited by carol' where id = %L$sql$, tests.rec_a2())),
  1, 'admin: updates dave''s record');
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_a2())),
  1, 'admin: deletes dave''s record');

-- column grants on modules and fields
select throws_ok(
  format($sql$update public.modules set workspace_id = %L where id = %L$sql$, tests.ws_b(), tests.mod_a2()),
  '42501', 'permission denied for table modules',
  'admin: cannot update modules.workspace_id');
select throws_ok(
  format($sql$update public.modules set created_by = %L where id = %L$sql$, tests.alice(), tests.mod_a2()),
  '42501', 'permission denied for table modules',
  'admin: cannot update modules.created_by');
select throws_ok(
  format($sql$update public.field_definitions set workspace_id = %L where id = %L$sql$, tests.ws_b(), tests.fld_a1()),
  '42501', 'permission denied for table field_definitions',
  'admin: cannot update field_definitions.workspace_id');
select throws_ok(
  format($sql$update public.field_definitions set module_id = %L where id = %L$sql$, tests.mod_a2(), tests.fld_a1()),
  '42501', 'permission denied for table field_definitions',
  'admin: cannot move a field to another module');
select throws_ok(
  format($sql$select tests.create_module(gen_random_uuid(), %L, 'forged', %L)$sql$, tests.ws_a(), tests.alice()),
  '42501', null,
  'admin: cannot create a module with someone else as created_by');

-- module delete cascades fields and records, writes module.deleted only
select lives_ok(
  format($sql$select tests.create_field(%L, %L, 'left_over', 'text')$sql$, tests.fld_a3(), tests.mod_a2()),
  'admin: adds a field to the module about to be deleted');
select lives_ok(
  format($sql$select tests.create_record(%L, %L, 'Doomed', '{"left_over": "x"}', p_created_by => %L)$sql$,
         tests.rec_a2(), tests.mod_a2(), tests.carol()),
  'admin: adds a record to the module about to be deleted');
select is(tests.rows_affected(format($sql$delete from public.modules where id = %L$sql$, tests.mod_a2())),
  1, 'admin: deletes the module');
select is((select count(*)::int from public.field_definitions where module_id = tests.mod_a2()), 0,
  'admin: the module''s fields cascaded');
select is((select count(*)::int from public.records where module_id = tests.mod_a2()), 0,
  'admin: the module''s records cascaded');
select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
             where workspace_id = %L and action = 'module.deleted' and entity_id = %L$sql$, tests.ws_a(), tests.mod_a2()::text),
  format($sql$values (%L::uuid, '{"name": "Renamed by admin", "slug": "renamed-by-admin"}'::jsonb)$sql$, tests.carol()),
  'admin: module.deleted is written with the final name and slug');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a() and action = 'field.deleted' and entity_id = tests.fld_a3()::text),
  0, 'admin: fields removed by the module cascade are not audited one by one');

select tests.logout();

-- ---------------------------------------------------------------------------
-- alice (owner): same powers as admin
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select lives_ok(
  format($sql$select tests.create_module(%L, %L, 'by-owner', %L)$sql$, tests.mod_a2(), tests.ws_a(), tests.alice()),
  'owner: creates a module');
select lives_ok(
  format($sql$select tests.create_field(%L, %L, 'notes', 'text')$sql$, tests.fld_a2(), tests.mod_a2()),
  'owner: creates a field');
select is(tests.rows_affected(format($sql$update public.field_definitions set type = 'number' where id = %L$sql$, tests.fld_a2())),
  1, 'owner: changes the type of an unused field');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a2())),
  1, 'owner: deletes a field');
select is(tests.rows_affected(format($sql$delete from public.modules where id = %L$sql$, tests.mod_a2())),
  1, 'owner: deletes a module');
select tests.logout();

-- Every audit row written through RLS in this file has an actor and a known
-- action (the two fixture rows written as postgres have actor_id null).
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.ws_a() and created_at >= now()
     and entity_type in ('module', 'field_definition')
     and entity_id not in (tests.mod_a()::text, tests.fld_a1()::text)
     and (actor_id is null or action not in ('module.created', 'module.updated', 'module.deleted', 'field.created', 'field.deleted'))),
  0, 'every module/field audit row written through RLS here has an actor and a documented action');
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.ws_a() and created_at >= now() and entity_id in (tests.mod_a()::text, tests.fld_a1()::text) and actor_id is not null),
  0, 'fixture rows written as postgres have actor_id null');

select * from finish();
rollback;
