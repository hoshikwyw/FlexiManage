-- 10: the anon role (browser without a session) can touch nothing.
-- Every table access and every helper call must fail with permission denied,
-- and auth.uid() is null.
create extension if not exists pgtap with schema extensions;

begin;
select plan(17);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

create function tests.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select tests.login_as_anon();

select is(current_user::text, 'anon', 'running as anon');
select is(auth.uid(), null::uuid, 'anon: auth.uid() is null');

-- select on each of the five tables
select throws_ok(format('select * from public.%I', t), '42501',
  format('permission denied for table %s', t),
  format('anon: select on public.%s is denied', t))
from unnest(array['profiles', 'workspaces', 'workspace_members', 'invitations', 'audit_events']) t;

-- writes
select throws_ok(
  $$insert into public.workspaces (name, slug, created_by) values ('x', 'x', '00000000-0000-0000-0000-00000000000a')$$,
  '42501', 'permission denied for table workspaces',
  'anon: insert into workspaces is denied');
select throws_ok(
  $$insert into public.workspace_members (workspace_id, user_id) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a')$$,
  '42501', 'permission denied for table workspace_members',
  'anon: insert into workspace_members is denied');
select throws_ok(
  $$insert into public.invitations (workspace_id, email) values ('00000000-0000-0000-0000-0000000000aa', 'x@example.com')$$,
  '42501', 'permission denied for table invitations',
  'anon: insert into invitations is denied');
select throws_ok(
  $$update public.workspaces set name = 'x'$$,
  '42501', 'permission denied for table workspaces',
  'anon: update on workspaces is denied');
select throws_ok(
  $$delete from public.workspaces$$,
  '42501', 'permission denied for table workspaces',
  'anon: delete on workspaces is denied');
select throws_ok(
  $$update public.profiles set full_name = 'x'$$,
  '42501', 'permission denied for table profiles',
  'anon: update on profiles is denied');

-- helper functions
select throws_ok(
  $$select public.is_workspace_member('00000000-0000-0000-0000-0000000000aa')$$,
  '42501', 'permission denied for function is_workspace_member',
  'anon: cannot execute is_workspace_member');
select throws_ok(
  $$select public.has_workspace_role('00000000-0000-0000-0000-0000000000aa', array['owner']::public.workspace_role[])$$,
  '42501', 'permission denied for function has_workspace_role',
  'anon: cannot execute has_workspace_role');
select throws_ok(
  $$select * from public.current_user_workspace_ids()$$,
  '42501', 'permission denied for function current_user_workspace_ids',
  'anon: cannot execute current_user_workspace_ids');
select throws_ok(
  $$select public.shares_workspace_with('00000000-0000-0000-0000-00000000000a')$$,
  '42501', 'permission denied for function shares_workspace_with',
  'anon: cannot execute shares_workspace_with');

select tests.logout();
select * from finish();
rollback;
