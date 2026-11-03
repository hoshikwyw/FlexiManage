-- 14: cross-workspace isolation on public.field_definitions (migration 004).
-- Covers the four section 7 matrix cells for `field_definitions` in both
-- directions, plus the composite foreign key: a field inserted in workspace A
-- can never point at a module of workspace B, even when the caller is a member
-- of A and the workspace_id passes RLS.
--
-- Independent of pre-existing rows: modules and fields are fixtures created
-- here; the delete control runs last.
create extension if not exists pgtap with schema extensions;

begin;
select plan(26);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): one module per workspace, one field each
-- ---------------------------------------------------------------------------
select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_module(tests.mod_b(), tests.ws_b(), 'test-module-b');
select tests.create_field(tests.fld_a1(), tests.mod_a(), 'company', 'text', true);
select tests.create_field(tests.fld_b1(), tests.mod_b(), 'budget', 'number');

create temp table fld_before as
  select id, workspace_id, module_id, key, label, type, required, position, options, settings, updated_at
  from public.field_definitions where id in (tests.fld_a1(), tests.fld_b1());

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.field_definitions where workspace_id = tests.ws_b()), 0,
  'alice: select of fields in B returns 0 rows');
select is((select count(*)::int from public.field_definitions where module_id = tests.mod_b()), 0,
  'alice: select of fields by B''s module id returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.field_definitions
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no field outside the workspaces she belongs to');
select is((select count(*)::int from public.field_definitions where id = tests.fld_a1()), 1,
  'alice: sees the field in A');

-- insert with B's workspace id (and B's module)
select throws_ok(
  format($sql$select tests.create_field(%L, %L, 'hijack', 'text')$sql$, tests.fld_a2(), tests.mod_b()),
  '42501', 'new row violates row-level security policy for table "field_definitions"',
  'alice: insert of a field with workspace B id is rejected by RLS');
-- composite FK: workspace A (passes RLS) but a module of B
select throws_ok(
  format($sql$select tests.create_field(%L, %L, 'hijack', 'text', p_ws => %L)$sql$, tests.fld_a2(), tests.mod_b(), tests.ws_a()),
  '23503', null,
  'alice: insert of a field in A pointing at a module of B fails the composite FK');

select is(tests.rows_affected(format($sql$update public.field_definitions set label = 'Pwned' where id = %L$sql$, tests.fld_b1())),
  0, 'alice: update of B''s field affects 0 rows');
select is(tests.rows_affected(format($sql$update public.field_definitions set required = true where module_id = %L$sql$, tests.mod_b())),
  0, 'alice: update of all fields of B''s module affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_b1())),
  0, 'alice: delete of B''s field affects 0 rows');

select tests.logout();
select results_eq(
  format('select id, workspace_id, module_id, key, label, type, required, position, options, settings, updated_at from public.field_definitions where id = %L', tests.fld_b1()),
  format('select id, workspace_id, module_id, key, label, type, required, position, options, settings, updated_at from fld_before where id = %L', tests.fld_b1()),
  'postgres: B''s field is unchanged after alice''s attempts');
select is((select count(*)::int from public.field_definitions where id = tests.fld_a2()), 0,
  'postgres: no hijack field was created');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.field_definitions where workspace_id = tests.ws_a()), 0,
  'bob: select of fields in A returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.field_definitions
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.bob()),
  'bob: sees no field outside the workspaces he belongs to');
select is((select count(*)::int from public.field_definitions where id = tests.fld_b1()), 1,
  'bob: sees the field in B');

select throws_ok(
  format($sql$select tests.create_field(%L, %L, 'hijack', 'text')$sql$, tests.fld_a2(), tests.mod_a()),
  '42501', null,
  'bob: insert of a field with workspace A id is rejected by RLS');
select throws_ok(
  format($sql$select tests.create_field(%L, %L, 'hijack', 'text', p_ws => %L)$sql$, tests.fld_a2(), tests.mod_a(), tests.ws_b()),
  '23503', null,
  'bob: insert of a field in B pointing at a module of A fails the composite FK');

select is(tests.rows_affected(format($sql$update public.field_definitions set label = 'Pwned' where id = %L$sql$, tests.fld_a1())),
  0, 'bob: update of A''s field affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a1())),
  0, 'bob: delete of A''s field affects 0 rows');

-- Positive control: the owner edits its own field.
select is(tests.rows_affected(format($sql$update public.field_definitions set label = 'Budget (EUR)' where id = %L$sql$, tests.fld_b1())),
  1, 'bob: update of his own field affects 1 row');

select tests.logout();
select results_eq(
  format('select id, workspace_id, module_id, key, label, type, required, position, options, settings, updated_at from public.field_definitions where id = %L', tests.fld_a1()),
  format('select id, workspace_id, module_id, key, label, type, required, position, options, settings, updated_at from fld_before where id = %L', tests.fld_a1()),
  'postgres: A''s field is unchanged after bob''s attempts');
select is((select label from public.field_definitions where id = tests.fld_b1()), 'Budget (EUR)',
  'postgres: bob''s relabel was applied');

-- ---------------------------------------------------------------------------
-- Positive controls, last (alice in A)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select lives_ok(
  format($sql$select tests.create_field(%L, %L, 'notes', 'text')$sql$, tests.fld_a2(), tests.mod_a()),
  'alice: insert of a field in her own module succeeds');
select throws_ok(
  format($sql$select tests.create_field(%L, %L, 'notes', 'text')$sql$, tests.fld_a3(), tests.mod_a()),
  '23505', null,
  'alice: a duplicate key inside the same module is 23505');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a1())),
  1, 'alice: delete of her own field affects 1 row');

select tests.logout();
select is((select count(*)::int from public.field_definitions where id = tests.fld_a1()), 0,
  'postgres: alice''s delete removed A''s field');
select is((select count(*)::int from public.field_definitions where id = tests.fld_b1()), 1,
  'postgres: B''s field survives');

select * from finish();
rollback;
