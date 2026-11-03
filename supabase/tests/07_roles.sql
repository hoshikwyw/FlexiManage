-- 07: role rules inside one workspace (docs/architecture.md capability table).
-- Fixtures created as postgres inside the transaction:
--   carol  admin of A      dave  member of A
--   erin, frank, grace     users with no membership (targets)
--   one pending invitation in A created by alice
-- Since migration 003 nobody adds members directly: every role gets
-- "permission denied" on insert into workspace_members (membership comes from
-- accept_invitation(), covered in 11). Where a later assertion needs erin,
-- frank or grace as a member, the row is inserted as postgres, standing in for
-- the security definer path.
--
-- Independent of pre-existing rows: member and invitation counts on A are
-- deltas on counts captured before the fixtures, and the final state check
-- looks only at memberships created inside this transaction.
create extension if not exists pgtap with schema extensions;

begin;
select plan(46);
\ir helpers/tests_schema.sql.inc

create function tests.inv_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000a001'::uuid $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.remember_count('a_members', (select count(*) from public.workspace_members where workspace_id = tests.ws_a()));
select tests.remember_count('a_invitations', (select count(*) from public.invitations where workspace_id = tests.ws_a()));

select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
select tests.create_user(tests.dave(),  'dave@example.com',  'Dave Example');
select tests.create_user(tests.erin(),  'erin@example.com',  'Erin Example');
select tests.create_user(tests.frank(), 'frank@example.com', 'Frank Example');
select tests.create_user(tests.grace(), 'grace@example.com', 'Grace Example');

insert into public.workspace_members (workspace_id, user_id, role) values
  (tests.ws_a(), tests.carol(), 'admin'),
  (tests.ws_a(), tests.dave(),  'member');

insert into public.invitations (id, workspace_id, email, role, invited_by)
values (tests.inv_a(), tests.ws_a(), 'invitee-a@example.com', 'member', tests.alice());

-- ---------------------------------------------------------------------------
-- dave (member): read everything except invitations, change nothing, may leave
-- ---------------------------------------------------------------------------
select tests.login_as(tests.dave());

select is((select count(*)::int from public.workspaces where id = tests.ws_a()), 1,
  'member: can read the workspace');
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a()), tests.recall_count('a_members') + 2,
  'member: can read all members of the workspace (the existing ones plus carol and dave)');
select ok((select count(*) from public.audit_events where workspace_id = tests.ws_a()) > 0,
  'member: can read the workspace audit log');
select is((select count(*)::int from public.invitations where workspace_id = tests.ws_a()), 0,
  'member: cannot see invitations');

select is(tests.rows_affected(format($sql$update public.workspaces set name = 'x' where id = %L$sql$, tests.ws_a())),
  0, 'member: cannot rename the workspace');
select is(tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_a())),
  0, 'member: cannot delete the workspace');

select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_a(), tests.erin()),
  '42501', null,
  'member: cannot add a member');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.carol())),
  0, 'member: cannot change another member''s role');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.dave())),
  0, 'member: cannot promote themselves');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.carol())),
  0, 'member: cannot remove an admin');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  0, 'member: cannot remove the owner');

select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, invited_by) values (%L, 'x@example.com', %L)$sql$,
         tests.ws_a(), tests.dave()),
  '42501', null,
  'member: cannot create an invitation');
select is(tests.rows_affected(format($sql$delete from public.invitations where id = %L$sql$, tests.inv_a())),
  0, 'member: cannot revoke an invitation');

select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.dave())),
  1, 'member: can leave the workspace');

select tests.logout();
select is(tests.role_in(tests.ws_a(), tests.dave()), null, 'postgres: dave is no longer a member after leaving');

-- ---------------------------------------------------------------------------
-- carol (admin)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());

select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a()), tests.recall_count('a_members') + 1,
  'admin: can read all members of the workspace (the existing ones plus carol)');
select is((select count(*)::int from public.invitations where workspace_id = tests.ws_a()), tests.recall_count('a_invitations') + 1,
  'admin: can list invitations (the existing ones plus the fixture)');
select is(tests.rows_affected(format($sql$update public.workspaces set name = 'Workspace A (admin)' where id = %L$sql$, tests.ws_a())),
  1, 'admin: can rename the workspace');
select is(tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_a())),
  0, 'admin: cannot delete the workspace');

select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_a(), tests.erin()),
  '42501',
  'permission denied for table workspace_members',
  'admin: cannot add a member directly (invitation acceptance is the only path)');
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'admin')$sql$,
         tests.ws_a(), tests.frank()),
  '42501', null,
  'admin: cannot add an admin directly');
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'owner')$sql$,
         tests.ws_a(), tests.grace()),
  '42501',
  'permission denied for table workspace_members',
  'admin: cannot add an owner');

-- erin (member) and frank (admin) join through the security definer path.
select tests.logout();
insert into public.workspace_members (workspace_id, user_id, role) values
  (tests.ws_a(), tests.erin(),  'member'),
  (tests.ws_a(), tests.frank(), 'admin');
select tests.login_as(tests.carol());

select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.erin())),
  0, 'admin: cannot promote a member');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.frank())),
  0, 'admin: cannot demote another admin');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.carol())),
  0, 'admin: cannot promote themselves to owner');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  0, 'admin: cannot demote the owner');

select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  0, 'admin: cannot remove an owner');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.erin())),
  1, 'admin: can remove a member');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.frank())),
  1, 'admin: can remove another admin');

select is(tests.rows_affected(format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'c1@example.com', 'member', %L)$sql$,
                                     tests.ws_a(), tests.carol())),
  1, 'admin: can invite as member');
select is(tests.rows_affected(format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'c2@example.com', 'admin', %L)$sql$,
                                     tests.ws_a(), tests.carol())),
  1, 'admin: can invite as admin');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'c3@example.com', 'owner', %L)$sql$,
         tests.ws_a(), tests.carol()),
  '42501',
  'new row violates row-level security policy for table "invitations"',
  'admin: cannot invite as owner');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'c4@example.com', 'member', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '42501', null,
  'admin: invitation insert requires invited_by = auth.uid()');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role) values (%L, 'c5@example.com', 'member')$sql$,
         tests.ws_a()),
  '42501', null,
  'admin: invitation insert with null invited_by is rejected');
select is(tests.rows_affected(format($sql$delete from public.invitations where workspace_id = %L and email = 'c2@example.com'$sql$, tests.ws_a())),
  1, 'admin: can revoke an invitation');

select tests.logout();
select is(tests.role_in(tests.ws_a(), tests.alice()), 'owner', 'postgres: alice is still owner after the admin''s attempts');

-- ---------------------------------------------------------------------------
-- alice (owner): everything
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'owner')$sql$,
         tests.ws_a(), tests.grace()),
  '42501',
  'permission denied for table workspace_members',
  'owner: cannot add an owner directly either');
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_a(), tests.erin()),
  '42501', null,
  'owner: cannot add a member directly either');

-- grace (owner) and erin (member) join through the security definer path.
select tests.logout();
insert into public.workspace_members (workspace_id, user_id, role) values
  (tests.ws_a(), tests.grace(), 'owner'),
  (tests.ws_a(), tests.erin(),  'member');
select tests.login_as(tests.alice());

select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.erin())),
  1, 'owner: can change a member''s role');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.erin())),
  1, 'owner: can remove an admin');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.grace())),
  1, 'owner: can remove another owner while one owner remains');
select is(tests.rows_affected(format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'o1@example.com', 'owner', %L)$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'owner: can invite as owner');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'o2@example.com', 'member', %L)$sql$,
         tests.ws_a(), tests.carol()),
  '42501', null,
  'owner: invitation insert still requires invited_by = auth.uid()');
select is(tests.rows_affected(format($sql$delete from public.invitations where id = %L$sql$, tests.inv_a())),
  1, 'owner: can revoke an invitation');

select tests.logout();
select is(tests.role_in(tests.ws_a(), tests.alice()), 'owner', 'postgres: alice ends as the owner of workspace A');
select results_eq(
  format('select user_id, role::text from public.workspace_members where workspace_id = %L and created_at >= now() order by user_id', tests.ws_a()),
  format($sql$values (%L::uuid, 'admin')$sql$, tests.carol()),
  'postgres: of the members added in this test only carol (admin) remains in workspace A'
);

select * from finish();
rollback;
