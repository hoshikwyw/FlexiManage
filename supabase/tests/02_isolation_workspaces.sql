-- 02: cross-workspace isolation on public.workspaces.
-- Alice owns Workspace A, Bob owns Workspace B (supabase/seed.sql). Neither is
-- a member of the other's workspace. Covers the four cells of the
-- docs/PLANNING.md section 7 matrix for `workspaces` in both directions.
--
-- Independent of pre-existing rows: "sees exactly X" is asserted as "sees
-- nothing outside the workspaces she is a member of" plus "sees X", the
-- untouched checks compare against a snapshot taken at the start, and the
-- positive delete control runs last (scoped to A) so nothing is re-inserted.
create extension if not exists pgtap with schema extensions;

begin;
select plan(22);
\ir helpers/tests_schema.sql.inc

-- Sanity: the seed is in place.
select is((select count(*)::int from public.workspaces where id in (tests.ws_a(), tests.ws_b())), 2,
  'seed: both workspaces exist');

-- Snapshot of both seed workspaces before any attempt (as postgres).
create temp table ws_before as
  select id, name, slug, created_by, updated_at from public.workspaces
  where id in (tests.ws_a(), tests.ws_b());
select tests.remember_text('ws_b_slug', (select slug from ws_before where id = tests.ws_b()));

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.workspaces where id = tests.ws_b()), 0,
  'alice: select of workspace B returns 0 rows');
select is_empty(
  format($sql$select id from public.workspaces
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no workspace she is not a member of');
select is((select count(*)::int from public.workspaces where id = tests.ws_a()), 1,
  'alice: sees workspace A');

select throws_ok(
  format($sql$insert into public.workspaces (name, slug, created_by) values ('Hijack', 'hijack-b', %L)$sql$, tests.bob()),
  '42501',
  'new row violates row-level security policy for table "workspaces"',
  'alice: insert of a workspace created_by bob is rejected by RLS'
);
select throws_ok(
  format($sql$insert into public.workspaces (id, name, slug, created_by) values (%L, 'Dup B', 'dup-b', %L)$sql$,
         tests.ws_b(), tests.bob()),
  '42501',
  null,
  'alice: insert with workspace B id and owner is rejected by RLS before any constraint'
);

select is(
  tests.rows_affected(format($sql$update public.workspaces set name = 'Pwned' where id = %L$sql$, tests.ws_b())),
  0, 'alice: update of workspace B affects 0 rows');
select is(
  tests.rows_affected(format($sql$update public.workspaces set slug = 'pwned-b' where slug = %L$sql$, tests.recall_text('ws_b_slug'))),
  0, 'alice: update of workspace B by slug affects 0 rows');

select is(
  tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_b())),
  0, 'alice: delete of workspace B affects 0 rows');

select tests.logout();
select results_eq(
  format('select id, name, slug, created_by, updated_at from public.workspaces where id = %L', tests.ws_b()),
  format('select id, name, slug, created_by, updated_at from ws_before where id = %L', tests.ws_b()),
  'postgres: workspace B is unchanged after alice''s attempts');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.workspaces where id = tests.ws_a()), 0,
  'bob: select of workspace A returns 0 rows');
select is_empty(
  format($sql$select id from public.workspaces
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.bob()),
  'bob: sees no workspace he is not a member of');
select is((select count(*)::int from public.workspaces where id = tests.ws_b()), 1,
  'bob: sees workspace B');

select throws_ok(
  format($sql$insert into public.workspaces (name, slug, created_by) values ('Hijack', 'hijack-a', %L)$sql$, tests.alice()),
  '42501',
  null,
  'bob: insert of a workspace created_by alice is rejected by RLS'
);

select is(
  tests.rows_affected(format($sql$update public.workspaces set name = 'Pwned' where id = %L$sql$, tests.ws_a())),
  0, 'bob: update of workspace A affects 0 rows');
select is(
  tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_a())),
  0, 'bob: delete of workspace A affects 0 rows');

-- Positive control: an owner can rename its own workspace.
select is(
  tests.rows_affected(format($sql$update public.workspaces set name = 'Workspace B renamed' where id = %L$sql$, tests.ws_b())),
  1, 'bob: update of his own workspace B affects 1 row');

select tests.logout();
select results_eq(
  format('select id, name, slug, created_by, updated_at from public.workspaces where id = %L', tests.ws_a()),
  format('select id, name, slug, created_by, updated_at from ws_before where id = %L', tests.ws_a()),
  'postgres: workspace A is unchanged after bob''s attempts');
select is((select name from public.workspaces where id = tests.ws_b()), 'Workspace B renamed',
  'postgres: bob''s rename of workspace B was applied');

-- ---------------------------------------------------------------------------
-- Positive control, last: an owner can delete its own workspace, and only that
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select is(
  tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_a())),
  1, 'alice: delete of her own workspace A affects 1 row');

select tests.logout();
select is((select count(*)::int from public.workspaces where id = tests.ws_a()), 0,
  'postgres: alice''s delete removed workspace A');
select is((select count(*)::int from public.workspaces where id = tests.ws_b()), 1,
  'postgres: workspace B survives alice''s delete of workspace A');

select * from finish();
rollback;
