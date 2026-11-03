-- 08: the last-owner guard (protect_last_owner trigger) and workspace delete.
-- A workspace always keeps at least one owner, except when the workspace
-- itself is deleted (the cascade is let through).
--
-- Independent of pre-existing rows: every assertion is scoped to A, B or the
-- users involved; bob's membership loss is a delta on his count.
create extension if not exists pgtap with schema extensions;

begin;
select plan(16);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
insert into public.workspace_members (workspace_id, user_id, role)
values (tests.ws_a(), tests.carol(), 'member');
insert into public.invitations (workspace_id, email, invited_by)
values (tests.ws_b(), 'invitee-b@example.com', tests.bob());

select tests.remember_count('bob_memberships', (select count(*) from public.workspace_members where user_id = tests.bob()));

-- ---------------------------------------------------------------------------
-- alice is the sole owner of A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select throws_like(
  format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.alice()),
  'cannot remove or demote the last owner of workspace %',
  'sole owner: demoting herself fails');
select throws_like(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.alice()),
  'cannot remove or demote the last owner of workspace %',
  'sole owner: leaving fails');

select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.carol())),
  1, 'sole owner: promoting carol to owner succeeds');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'with a second owner: demoting the first owner succeeds');

select tests.logout();
select is(tests.role_in(tests.ws_a(), tests.alice()), 'member', 'postgres: alice is now a member of A');
select is(tests.role_in(tests.ws_a(), tests.carol()), 'owner',  'postgres: carol is now the owner of A');

-- ---------------------------------------------------------------------------
-- carol is now the sole owner
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());

select throws_ok(
  format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.carol()),
  'P0001', null,
  'new sole owner: demoting herself fails with P0001');
select throws_ok(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.carol()),
  'P0001', null,
  'new sole owner: leaving fails with P0001');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'new sole owner: removing the demoted former owner (now a member) succeeds');

-- The guard is a trigger, so it also binds roles that bypass RLS.
select tests.logout();
select throws_like(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.carol()),
  'cannot remove or demote the last owner of workspace %',
  'postgres: the guard applies even when RLS is bypassed');

-- ---------------------------------------------------------------------------
-- Deleting the workspace as owner succeeds despite the guard (cascade)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());
select is(tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_b())),
  1, 'owner: deleting the workspace succeeds although bob is its last owner');

select tests.logout();
select is((select count(*)::int from public.workspaces where id = tests.ws_b()), 0,
  'postgres: workspace B is gone');
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_b()), 0,
  'postgres: workspace B memberships were cascaded');
select is((select count(*)::int from public.invitations where workspace_id = tests.ws_b()), 0,
  'postgres: workspace B invitations were cascaded');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_b()), 0,
  'postgres: workspace B audit events were cascaded');
select is((select count(*)::int from public.workspace_members where user_id = tests.bob()), tests.recall_count('bob_memberships') - 1,
  'postgres: bob lost exactly his workspace B membership');

select * from finish();
rollback;
