-- 15: cross-workspace isolation on public.records (migration 004).
-- Covers the four section 7 matrix cells for `records` in both directions,
-- plus the composite foreign key: a record inserted in workspace A can never
-- point at a module of workspace B. Also checks that a search across all
-- visible records never leaks a row of the other workspace.
--
-- Independent of pre-existing rows: modules, fields and records are fixtures
-- created here; the delete control runs last.
create extension if not exists pgtap with schema extensions;

begin;
select plan(28);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_module(tests.mod_b(), tests.ws_b(), 'test-module-b');
select tests.create_field(tests.fld_a1(), tests.mod_a(), 'company', 'text');
select tests.create_field(tests.fld_b1(), tests.mod_b(), 'budget', 'number');
select tests.create_record(tests.rec_a1(), tests.mod_a(), 'Record in A', '{"company": "Zebrafish Ltd"}');
select tests.create_record(tests.rec_b1(), tests.mod_b(), 'Record in B', '{"budget": 4200}');

create temp table rec_before as
  select id, workspace_id, module_id, title, status, custom_values, created_by, updated_at
  from public.records where id in (tests.rec_a1(), tests.rec_b1());

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.records where workspace_id = tests.ws_b()), 0,
  'alice: select of records in B returns 0 rows');
select is((select count(*)::int from public.records where module_id = tests.mod_b()), 0,
  'alice: select of records by B''s module id returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.records
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no record outside the workspaces she belongs to');
select is((select count(*)::int from public.records where id = tests.rec_a1()), 1,
  'alice: sees the record in A');
select is((select count(*)::int from public.records where search_vector @@ to_tsquery('simple', 'record') and workspace_id <> tests.ws_a()), 0,
  'alice: a full-text search across all visible records returns nothing from B');
select is((select count(*)::int from public.records where custom_values @> '{"budget": 4200}'), 0,
  'alice: a custom_values containment search returns nothing from B');

-- insert with B's workspace id (and B's module)
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'Hijack', '{}', p_created_by => %L)$sql$, tests.rec_a2(), tests.mod_b(), tests.alice()),
  '42501', 'new row violates row-level security policy for table "records"',
  'alice: insert of a record with workspace B id is rejected by RLS');
-- composite FK: workspace A (passes RLS) but a module of B
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'Hijack', '{}', p_created_by => %L, p_ws => %L)$sql$,
         tests.rec_a2(), tests.mod_b(), tests.alice(), tests.ws_a()),
  '23503', null,
  'alice: insert of a record in A pointing at a module of B fails the composite FK');

select is(tests.rows_affected(format($sql$update public.records set title = 'Pwned' where id = %L$sql$, tests.rec_b1())),
  0, 'alice: update of B''s record affects 0 rows');
select is(tests.rows_affected(format($sql$update public.records set custom_values = '{}' where workspace_id = %L$sql$, tests.ws_b())),
  0, 'alice: update of all records in B affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_b1())),
  0, 'alice: delete of B''s record affects 0 rows');

select tests.logout();
select results_eq(
  format('select id, workspace_id, module_id, title, status, custom_values, created_by, updated_at from public.records where id = %L', tests.rec_b1()),
  format('select id, workspace_id, module_id, title, status, custom_values, created_by, updated_at from rec_before where id = %L', tests.rec_b1()),
  'postgres: B''s record is unchanged after alice''s attempts');
select is((select count(*)::int from public.records where id = tests.rec_a2()), 0,
  'postgres: no hijack record was created');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.records where workspace_id = tests.ws_a()), 0,
  'bob: select of records in A returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.records
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.bob()),
  'bob: sees no record outside the workspaces he belongs to');
select is((select count(*)::int from public.records where id = tests.rec_b1()), 1,
  'bob: sees the record in B');
select is((select count(*)::int from public.records where title ilike 'record%' and workspace_id <> tests.ws_b()), 0,
  'bob: a title search across all visible records returns nothing from A');

select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'Hijack', '{}', p_created_by => %L)$sql$, tests.rec_a2(), tests.mod_a(), tests.bob()),
  '42501', null,
  'bob: insert of a record with workspace A id is rejected by RLS');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'Hijack', '{}', p_created_by => %L, p_ws => %L)$sql$,
         tests.rec_a2(), tests.mod_a(), tests.bob(), tests.ws_b()),
  '23503', null,
  'bob: insert of a record in B pointing at a module of A fails the composite FK');

select is(tests.rows_affected(format($sql$update public.records set title = 'Pwned' where id = %L$sql$, tests.rec_a1())),
  0, 'bob: update of A''s record affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_a1())),
  0, 'bob: delete of A''s record affects 0 rows');

-- Positive control: the owner edits its own record.
select is(tests.rows_affected(format($sql$update public.records set title = 'Record in B renamed' where id = %L$sql$, tests.rec_b1())),
  1, 'bob: update of his own record affects 1 row');

select tests.logout();
select results_eq(
  format('select id, workspace_id, module_id, title, status, custom_values, created_by, updated_at from public.records where id = %L', tests.rec_a1()),
  format('select id, workspace_id, module_id, title, status, custom_values, created_by, updated_at from rec_before where id = %L', tests.rec_a1()),
  'postgres: A''s record is unchanged after bob''s attempts');
select is((select title from public.records where id = tests.rec_b1()), 'Record in B renamed',
  'postgres: bob''s rename was applied');

-- ---------------------------------------------------------------------------
-- Positive controls, last (alice in A)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select lives_ok(
  format($sql$select tests.create_record(%L, %L, 'Second in A', '{"company": "Yak Inc"}', p_created_by => %L)$sql$,
         tests.rec_a2(), tests.mod_a(), tests.alice()),
  'alice: insert of a record in her own module succeeds');
select is(tests.rows_affected(format($sql$delete from public.records where id = %L$sql$, tests.rec_a1())),
  1, 'alice: delete of her own record affects 1 row');

select tests.logout();
select is((select count(*)::int from public.records where id = tests.rec_a1()), 0,
  'postgres: alice''s delete removed A''s record');
select is((select count(*)::int from public.records where id = tests.rec_b1()), 1,
  'postgres: B''s record survives');

select * from finish();
rollback;
