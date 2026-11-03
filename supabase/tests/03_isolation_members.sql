-- 03: cross-workspace isolation on public.workspace_members.
-- The critical case: a user must not be able to insert themselves into a
-- workspace they do not belong to, nor see, change or remove its members.
-- Covers the four section 7 matrix cells for `workspace_members` both ways.
-- Since migration 003 authenticated has no insert grant at all (membership is
-- created only by accept_invitation() and the workspace trigger), so inserts
-- fail with "permission denied" before RLS is even evaluated.
--
-- Independent of pre-existing rows: visibility is asserted as "no membership
-- row outside the caller's own workspaces" plus the caller's own row, and the
-- untouched checks compare A's and B's memberships with a snapshot taken at
-- the start.
create extension if not exists pgtap with schema extensions;

begin;
select plan(19);
\ir helpers/tests_schema.sql.inc

-- Snapshot of both seed workspaces' memberships before any attempt (as postgres).
create temp table members_before as
  select workspace_id, user_id, role, updated_at from public.workspace_members
  where workspace_id in (tests.ws_a(), tests.ws_b());

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_b()), 0,
  'alice: select of workspace B members returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.workspace_members
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no membership row outside her own workspaces');
select results_eq(
  format('select user_id, role::text from public.workspace_members where workspace_id = %L and user_id = %L',
         tests.ws_a(), tests.alice()),
  format($sql$values (%L::uuid, 'owner')$sql$, tests.alice()),
  'alice: sees her own owner membership in workspace A'
);

select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_b(), tests.alice()),
  '42501',
  'permission denied for table workspace_members',
  'alice: cannot add herself to workspace B as member'
);
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'owner')$sql$,
         tests.ws_b(), tests.alice()),
  '42501',
  null,
  'alice: cannot add herself to workspace B as owner'
);
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'admin')$sql$,
         tests.ws_b(), tests.bob()),
  '42501',
  null,
  'alice: cannot insert any membership row with workspace B id'
);

select is(
  tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                             tests.ws_b(), tests.bob())),
  0, 'alice: update of bob''s membership in workspace B affects 0 rows');
select is(
  tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L$sql$, tests.ws_b())),
  0, 'alice: update of all workspace B memberships affects 0 rows');

select is(
  tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                             tests.ws_b(), tests.bob())),
  0, 'alice: delete of bob''s membership in workspace B affects 0 rows');
select is(
  tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L$sql$, tests.ws_b())),
  0, 'alice: delete of all workspace B memberships affects 0 rows');

select tests.logout();
select results_eq(
  format('select workspace_id, user_id, role, updated_at from public.workspace_members where workspace_id = %L order by user_id', tests.ws_b()),
  format('select workspace_id, user_id, role, updated_at from members_before where workspace_id = %L order by user_id', tests.ws_b()),
  'postgres: workspace B memberships are unchanged after alice''s attempts'
);
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_b() and user_id = tests.alice()), 0,
  'postgres: alice has no membership in workspace B');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a()), 0,
  'bob: select of workspace A members returns 0 rows');
select is_empty(
  format($sql$select workspace_id from public.workspace_members
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.bob()),
  'bob: sees no membership row outside his own workspaces');
select results_eq(
  format('select user_id, role::text from public.workspace_members where workspace_id = %L and user_id = %L',
         tests.ws_b(), tests.bob()),
  format($sql$values (%L::uuid, 'owner')$sql$, tests.bob()),
  'bob: sees his own owner membership in workspace B'
);

select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_a(), tests.bob()),
  '42501',
  null,
  'bob: cannot add himself to workspace A'
);

select is(
  tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                             tests.ws_a(), tests.alice())),
  0, 'bob: update of alice''s membership in workspace A affects 0 rows');
select is(
  tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                             tests.ws_a(), tests.alice())),
  0, 'bob: delete of alice''s membership in workspace A affects 0 rows');

select tests.logout();
select results_eq(
  format('select workspace_id, user_id, role, updated_at from public.workspace_members where workspace_id = %L order by user_id', tests.ws_a()),
  format('select workspace_id, user_id, role, updated_at from members_before where workspace_id = %L order by user_id', tests.ws_a()),
  'postgres: workspace A memberships are unchanged after bob''s attempts'
);

select * from finish();
rollback;
