-- 01: structural guarantees of migration 001.
--   * every table in public has row level security enabled
--   * anon has no privilege on any public table; authenticated has exactly the
--     table and column grants documented in docs/architecture.md
--   * the policy set per table matches the documented names
--   * RLS helpers are security definer, stable, have a fixed search_path and
--     are executable by authenticated only; trigger functions by nobody
--
-- Run with `npx supabase test db`. The whole file runs in one transaction
-- that is rolled back at the end.
create extension if not exists pgtap with schema extensions;

begin;
select plan(83);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has row level security enabled'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public'),
  5,
  'migration 001 creates exactly five tables in public'
);

select ok(
  (select c.relrowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = t),
  format('rls is enabled on public.%s', t)
)
from unnest(array['profiles', 'workspaces', 'workspace_members', 'invitations', 'audit_events']) t;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
select table_privs_are('public', t, 'anon', '{}'::text[], format('anon has no privilege on public.%s', t))
from unnest(array['profiles', 'workspaces', 'workspace_members', 'invitations', 'audit_events']) t;

-- has_table_privilege ignores column-level grants, so UPDATE is absent here
-- and asserted per column below.
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT'],
  'authenticated may only select profiles at table level');
select table_privs_are('public', 'workspaces', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated may select, insert, delete workspaces at table level');
select table_privs_are('public', 'workspace_members', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated may select, insert, delete workspace_members at table level');
select table_privs_are('public', 'invitations', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated may select, insert, delete invitations at table level');
select table_privs_are('public', 'audit_events', 'authenticated', array['SELECT'],
  'authenticated may only select audit_events');

-- Column-level update grants (has_column_privilege also reports table-level
-- SELECT/INSERT, so those appear in the expected lists).
select column_privs_are('public', 'profiles', 'full_name', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated may update profiles.full_name');
select column_privs_are('public', 'profiles', 'avatar_url', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated may update profiles.avatar_url');
select column_privs_are('public', 'profiles', 'email', 'authenticated', array['SELECT'],
  'authenticated may not update profiles.email');
select column_privs_are('public', 'profiles', 'id', 'authenticated', array['SELECT'],
  'authenticated may not update profiles.id');
select column_privs_are('public', 'workspaces', 'name', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated may update workspaces.name');
select column_privs_are('public', 'workspaces', 'slug', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated may update workspaces.slug');
select column_privs_are('public', 'workspaces', 'created_by', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may not update workspaces.created_by');
select column_privs_are('public', 'workspace_members', 'role', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated may update workspace_members.role');
select column_privs_are('public', 'workspace_members', 'user_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may not update workspace_members.user_id');
select column_privs_are('public', 'workspace_members', 'workspace_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may not update workspace_members.workspace_id');
select column_privs_are('public', 'invitations', 'accepted_at', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may not update invitations.accepted_at');
select column_privs_are('public', 'audit_events', 'metadata', 'authenticated', array['SELECT'],
  'authenticated may not update audit_events.metadata');

-- ---------------------------------------------------------------------------
-- Policies: one per command, named <table>_<command>_<who>
-- ---------------------------------------------------------------------------
select policies_are('public', 'profiles',
  array['profiles_select_self_or_shared_workspace', 'profiles_update_self'],
  'profiles has exactly the documented policies');
select policies_are('public', 'workspaces',
  array['workspaces_select_member', 'workspaces_insert_creator',
        'workspaces_update_owner_admin', 'workspaces_delete_owner'],
  'workspaces has exactly the documented policies');
select policies_are('public', 'workspace_members',
  array['workspace_members_select_member', 'workspace_members_insert_owner_admin',
        'workspace_members_update_owner', 'workspace_members_delete_owner_admin_or_self'],
  'workspace_members has exactly the documented policies');
select policies_are('public', 'invitations',
  array['invitations_select_owner_admin', 'invitations_insert_owner_admin',
        'invitations_delete_owner_admin'],
  'invitations has exactly the documented policies');
select policies_are('public', 'audit_events',
  array['audit_events_select_member'],
  'audit_events has exactly the documented policies');

-- Every policy is scoped to authenticated, never to public or anon.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and roles <> array['authenticated']::name[]),
  0,
  'every policy in public applies to the authenticated role only'
);

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
create temp table helper_fn (fname text, fargs text[]) on commit drop;
insert into helper_fn values
  ('is_workspace_member', array['uuid']),
  ('has_workspace_role', array['uuid', 'public.workspace_role[]']),
  ('current_user_workspace_ids', '{}'::text[]),
  ('shares_workspace_with', array['uuid']);

select is_definer('public', fname, fargs, format('%s is security definer', fname)) from helper_fn;
select volatility_is('public', fname, fargs, 'stable', format('%s is stable', fname)) from helper_fn;
select function_privs_are('public', fname, fargs, 'anon', '{}'::text[],
  format('anon cannot execute %s', fname)) from helper_fn;
select function_privs_are('public', fname, fargs, 'authenticated', array['EXECUTE'],
  format('authenticated can execute %s', fname)) from helper_fn;
select function_privs_are('public', fname, fargs, 'public', '{}'::text[],
  format('public cannot execute %s', fname)) from helper_fn;

-- ---------------------------------------------------------------------------
-- Trigger functions: fixed search_path, not callable by any API role
-- ---------------------------------------------------------------------------
create temp table trigger_fn (fname text, definer boolean) on commit drop;
insert into trigger_fn values
  ('set_updated_at', false),
  ('handle_new_user', true),
  ('handle_new_workspace', true),
  ('protect_last_owner', true),
  ('audit_workspace_member_change', true),
  ('audit_invitation_change', true);

select is_definer('public', fname, '{}'::text[], format('%s is security definer', fname))
from trigger_fn where definer;
select function_privs_are('public', fname, '{}'::text[], 'anon', '{}'::text[],
  format('anon cannot execute %s', fname)) from trigger_fn;
select function_privs_are('public', fname, '{}'::text[], 'authenticated', '{}'::text[],
  format('authenticated cannot execute %s', fname)) from trigger_fn;

-- search_path is pinned on every function in public (helpers and triggers).
select ok(
  exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'),
  format('%s has a fixed search_path', p.proname)
)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname;

select is(
  (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace),
  10,
  'migration 001 defines exactly ten functions in public'
);

select * from finish();
rollback;
