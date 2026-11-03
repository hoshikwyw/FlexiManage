-- 13: cross-workspace isolation on public.modules (migration 004).
-- Alice owns Workspace A, Bob owns Workspace B; neither is a member of the
-- other's workspace. Covers the four cells of the docs/PLANNING.md section 7
-- matrix for `modules` in both directions.
--
-- Independent of pre-existing rows: the module fixtures are created here
-- (tests.mod_a in A, tests.mod_b in B), "sees exactly X" is asserted as "sees
-- nothing outside the workspaces the user belongs to" plus "sees the fixture",
-- and the positive delete control runs last.
create extension if not exists pgtap with schema extensions;

begin;
select plan(24);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_module(tests.mod_b(), tests.ws_b(), 'test-module-b');

create temp table mod_before as
  select id, workspace_id, name, slug, description, icon, position, created_by, updated_at
  from public.modules where id in (tests.mod_a(), tests.mod_b());

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.modules where workspace_id = tests.ws_b()), 0,
  'alice: select of modules in B returns 0 rows');
select is((select count(*)::int from public.modules where id = tests.mod_b()), 0,
  'alice: select of B''s module by id returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.modules
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no module outside the workspaces she belongs to');
select is((select count(*)::int from public.modules where id = tests.mod_a()), 1,
  'alice: sees the module in A');

select throws_ok(
  format($sql$insert into public.modules (workspace_id, name, slug, created_by) values (%L, 'Hijack', 'hijack', %L)$sql$,
         tests.ws_b(), tests.alice()),
  '42501', 'new row violates row-level security policy for table "modules"',
  'alice: insert of a module with workspace B id is rejected by RLS');
select throws_ok(
  format($sql$insert into public.modules (workspace_id, name, slug, created_by) values (%L, 'Hijack', 'hijack', %L)$sql$,
         tests.ws_b(), tests.bob()),
  '42501', null,
  'alice: insert of a module in B with bob as created_by is rejected by RLS');

select is(tests.rows_affected(format($sql$update public.modules set name = 'Pwned' where id = %L$sql$, tests.mod_b())),
  0, 'alice: update of B''s module affects 0 rows');
select is(tests.rows_affected(format($sql$update public.modules set position = 99 where workspace_id = %L$sql$, tests.ws_b())),
  0, 'alice: update of all modules in B affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.modules where id = %L$sql$, tests.mod_b())),
  0, 'alice: delete of B''s module affects 0 rows');

select tests.logout();
select results_eq(
  format('select id, workspace_id, name, slug, description, icon, position, created_by, updated_at from public.modules where id = %L', tests.mod_b()),
  format('select id, workspace_id, name, slug, description, icon, position, created_by, updated_at from mod_before where id = %L', tests.mod_b()),
  'postgres: B''s module is unchanged after alice''s attempts');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.modules where workspace_id = tests.ws_a()), 0,
  'bob: select of modules in A returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.modules
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.bob()),
  'bob: sees no module outside the workspaces he belongs to');
select is((select count(*)::int from public.modules where id = tests.mod_b()), 1,
  'bob: sees the module in B');

select throws_ok(
  format($sql$insert into public.modules (workspace_id, name, slug, created_by) values (%L, 'Hijack', 'hijack', %L)$sql$,
         tests.ws_a(), tests.bob()),
  '42501', null,
  'bob: insert of a module with workspace A id is rejected by RLS');

select is(tests.rows_affected(format($sql$update public.modules set name = 'Pwned' where id = %L$sql$, tests.mod_a())),
  0, 'bob: update of A''s module affects 0 rows');
select is(tests.rows_affected(format($sql$delete from public.modules where id = %L$sql$, tests.mod_a())),
  0, 'bob: delete of A''s module affects 0 rows');

-- Positive control: the owner can rename its own module.
select is(tests.rows_affected(format($sql$update public.modules set name = 'Module B renamed' where id = %L$sql$, tests.mod_b())),
  1, 'bob: update of his own module affects 1 row');

select tests.logout();
select results_eq(
  format('select id, workspace_id, name, slug, description, icon, position, created_by, updated_at from public.modules where id = %L', tests.mod_a()),
  format('select id, workspace_id, name, slug, description, icon, position, created_by, updated_at from mod_before where id = %L', tests.mod_a()),
  'postgres: A''s module is unchanged after bob''s attempts');
select is((select name from public.modules where id = tests.mod_b()), 'Module B renamed',
  'postgres: bob''s rename was applied');

-- The unique (workspace_id, slug) is per workspace: the same slug may exist in A and B.
select tests.login_as(tests.alice());
select is(tests.rows_affected(format($sql$insert into public.modules (workspace_id, name, slug, created_by) values (%L, 'Same slug', 'test-module-b', %L)$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'alice: can reuse a slug that exists in B inside A');
select throws_ok(
  format($sql$insert into public.modules (workspace_id, name, slug, created_by) values (%L, 'Dup', 'test-module-a', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '23505', null,
  'alice: a duplicate slug inside A is 23505');

-- ---------------------------------------------------------------------------
-- Positive control, last: the owner deletes its own module, and only that
-- ---------------------------------------------------------------------------
select is(tests.rows_affected(format($sql$delete from public.modules where id = %L$sql$, tests.mod_a())),
  1, 'alice: delete of her own module affects 1 row');

select tests.logout();
select is((select count(*)::int from public.modules where id = tests.mod_a()), 0,
  'postgres: alice''s delete removed A''s module');
select is((select count(*)::int from public.modules where id = tests.mod_b()), 1,
  'postgres: B''s module survives');

select * from finish();
rollback;
