-- 01: structural guarantees of migrations 001 to 005.
--   * every table in public has row level security enabled
--   * anon has no privilege on any public table; authenticated has exactly the
--     table and column grants documented in docs/architecture.md (migration 003
--     removed the insert grant on workspace_members, narrowed invitations to
--     column-level select/insert grants and hid invitations.token)
--   * migration 004 adds modules, field_definitions and records with
--     column-level insert/update grants (no search_vector, created_at,
--     updated_at; workspace_id and module_id not updatable)
--   * migration 005 adds attachments (select/delete at table level, insert
--     column-level on workspace_id, record_id, file_name, content_type,
--     size_bytes; no update) and storage_deletion_queue (nothing for API roles)
--   * the policy set per table matches the documented names
--   * RLS helpers (and workspace_usage) are security definer, stable, have a
--     fixed search_path and are executable by authenticated only; trigger
--     functions by nobody; the three pure immutable helpers used by check
--     constraints and the generated column stay executable
--
-- Run with `npx supabase test db`. The whole file runs in one transaction
-- that is rolled back at the end.
create extension if not exists pgtap with schema extensions;

begin;
select plan(214);

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
  10,
  'migrations 001 to 005 create exactly ten tables in public'
);

select ok(
  (select c.relrowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = t),
  format('rls is enabled on public.%s', t)
)
from unnest(array['profiles', 'workspaces', 'workspace_members', 'invitations', 'audit_events',
                  'modules', 'field_definitions', 'records', 'attachments', 'storage_deletion_queue']) t;

select has_enum('public', 'field_type', 'enum public.field_type exists');
select enum_has_labels('public', 'field_type', array['text', 'number', 'date', 'select', 'checkbox', 'currency'],
  'field_type has the six documented labels');

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
select table_privs_are('public', t, 'anon', '{}'::text[], format('anon has no privilege on public.%s', t))
from unnest(array['profiles', 'workspaces', 'workspace_members', 'invitations', 'audit_events',
                  'modules', 'field_definitions', 'records', 'attachments', 'storage_deletion_queue']) t;

-- has_table_privilege ignores column-level grants, so UPDATE is absent here
-- and asserted per column below.
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT'],
  'authenticated may only select profiles at table level');
select table_privs_are('public', 'workspaces', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated may select, insert, delete workspaces at table level');
select table_privs_are('public', 'workspace_members', 'authenticated', array['SELECT', 'DELETE'],
  'authenticated may select, delete workspace_members at table level (no insert: invitation acceptance only)');
-- Migration 003: select and insert on invitations are column-level grants.
select table_privs_are('public', 'invitations', 'authenticated', array['DELETE'],
  'authenticated may only delete invitations at table level');
select table_privs_are('public', 'audit_events', 'authenticated', array['SELECT'],
  'authenticated may only select audit_events');
-- Migration 004: insert and update on the content tables are column-level grants.
select table_privs_are('public', t, 'authenticated', array['SELECT', 'DELETE'],
  format('authenticated may select and delete %s at table level (insert/update are column-level)', t))
from unnest(array['modules', 'field_definitions', 'records']) t;
-- Migration 005.
select table_privs_are('public', 'attachments', 'authenticated', array['SELECT', 'DELETE'],
  'authenticated may select and delete attachments at table level (insert is column-level, no update)');
select table_privs_are('public', 'storage_deletion_queue', 'authenticated', '{}'::text[],
  'authenticated has no privilege on storage_deletion_queue');

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
select column_privs_are('public', 'workspace_members', 'role', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated may update workspace_members.role');
select column_privs_are('public', 'workspace_members', 'user_id', 'authenticated', array['SELECT'],
  'authenticated may not insert or update workspace_members.user_id');
select column_privs_are('public', 'workspace_members', 'workspace_id', 'authenticated', array['SELECT'],
  'authenticated may not insert or update workspace_members.workspace_id');
select column_privs_are('public', 'invitations', 'accepted_at', 'authenticated', array['SELECT'],
  'authenticated may only read invitations.accepted_at');
select column_privs_are('public', 'invitations', 'email', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may read and insert invitations.email');
select column_privs_are('public', 'invitations', 'id', 'authenticated', array['SELECT'],
  'authenticated may read but not supply invitations.id');
select column_privs_are('public', 'invitations', 'token', 'authenticated', '{}'::text[],
  'authenticated has no privilege on invitations.token');
select column_privs_are('public', 'audit_events', 'metadata', 'authenticated', array['SELECT'],
  'authenticated may not update audit_events.metadata');
-- Migration 004 content tables.
select column_privs_are('public', 'modules', 'workspace_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update modules.workspace_id');
select column_privs_are('public', 'modules', 'name', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated may insert and update modules.name');
select column_privs_are('public', 'modules', 'created_by', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update modules.created_by');
select column_privs_are('public', 'modules', 'created_at', 'authenticated', array['SELECT'],
  'authenticated may only read modules.created_at');
select column_privs_are('public', 'field_definitions', 'key', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated may insert and update field_definitions.key (the trigger rejects changes with 23514)');
select column_privs_are('public', 'field_definitions', 'module_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update field_definitions.module_id');
select column_privs_are('public', 'field_definitions', 'workspace_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update field_definitions.workspace_id');
select column_privs_are('public', 'records', 'search_vector', 'authenticated', array['SELECT'],
  'authenticated may only read records.search_vector');
select column_privs_are('public', 'records', 'workspace_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update records.workspace_id');
select column_privs_are('public', 'records', 'module_id', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update records.module_id');
select column_privs_are('public', 'records', 'custom_values', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated may insert and update records.custom_values');
select column_privs_are('public', 'records', 'created_by', 'authenticated', array['SELECT', 'INSERT'],
  'authenticated may insert but not update records.created_by');
-- Migration 005 attachments: insert only on the five client columns, update never.
select column_privs_are('public', 'attachments', c, 'authenticated', array['SELECT', 'INSERT'],
  format('authenticated may insert but not update attachments.%s', c))
from unnest(array['workspace_id', 'record_id', 'file_name', 'content_type', 'size_bytes']) c;
select column_privs_are('public', 'attachments', c, 'authenticated', array['SELECT'],
  format('authenticated may only read attachments.%s', c))
from unnest(array['id', 'storage_path', 'uploaded_by', 'created_at']) c;

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
  array['workspace_members_select_member',
        'workspace_members_update_owner', 'workspace_members_delete_owner_admin_or_self'],
  'workspace_members has exactly the documented policies');
select policies_are('public', 'invitations',
  array['invitations_select_owner_admin', 'invitations_insert_owner_admin',
        'invitations_delete_owner_admin'],
  'invitations has exactly the documented policies');
select policies_are('public', 'audit_events',
  array['audit_events_select_member'],
  'audit_events has exactly the documented policies');
select policies_are('public', 'modules',
  array['modules_select_member', 'modules_insert_owner_admin',
        'modules_update_owner_admin', 'modules_delete_owner_admin'],
  'modules has exactly the documented policies');
select policies_are('public', 'field_definitions',
  array['field_definitions_select_member', 'field_definitions_insert_owner_admin',
        'field_definitions_update_owner_admin', 'field_definitions_delete_owner_admin'],
  'field_definitions has exactly the documented policies');
select policies_are('public', 'records',
  array['records_select_member', 'records_insert_member',
        'records_update_member', 'records_delete_member'],
  'records has exactly the documented policies');
select policies_are('public', 'attachments',
  array['attachments_select_member', 'attachments_insert_member',
        'attachments_delete_uploader_or_owner_admin'],
  'attachments has exactly the documented policies (no update policy)');
select policies_are('public', 'storage_deletion_queue', '{}'::name[],
  'storage_deletion_queue has no policy (service role only)');

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
  ('shares_workspace_with', array['uuid']),
  ('workspace_usage', array['uuid']),
  ('can_read_attachment_object', array['text']),
  ('can_upload_attachment_object', array['text', 'jsonb']),
  ('can_delete_attachment_object', array['text']);

select is_definer('public', fname, fargs, format('%s is security definer', fname)) from helper_fn;
select volatility_is('public', fname, fargs, 'stable', format('%s is stable', fname)) from helper_fn;
select function_privs_are('public', fname, fargs, 'anon', '{}'::text[],
  format('anon cannot execute %s', fname)) from helper_fn;
select function_privs_are('public', fname, fargs, 'authenticated', array['EXECUTE'],
  format('authenticated can execute %s', fname)) from helper_fn;
select function_privs_are('public', fname, fargs, 'public', '{}'::text[],
  format('public cannot execute %s', fname)) from helper_fn;

-- ---------------------------------------------------------------------------
-- Pure helpers (migration 004): immutable, no security definer, executable by
-- the writing roles because check constraints and the generated column run
-- with the caller's privileges
-- ---------------------------------------------------------------------------
create temp table pure_fn (fname text, fargs text[]) on commit drop;
insert into pure_fn values
  ('jsonb_values_text', array['jsonb']),
  ('field_options_are_valid', array['public.field_type', 'jsonb']),
  ('field_settings_are_valid', array['public.field_type', 'jsonb']),
  ('attachment_content_type_is_allowed', array['text']),
  ('attachment_file_name_is_valid', array['text']);

select volatility_is('public', fname, fargs, 'immutable', format('%s is immutable', fname)) from pure_fn;
select isnt_definer('public', fname, fargs, format('%s is not security definer', fname)) from pure_fn;
select function_privs_are('public', fname, fargs, 'authenticated', array['EXECUTE'],
  format('authenticated can execute %s (needed by the check constraint / generated column)', fname)) from pure_fn;

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
  ('audit_invitation_change', true),
  ('handle_user_deleted', true),
  ('handle_user_email_changed', true),
  ('validate_record_custom_values', true),
  ('protect_field_definition', true),
  ('handle_field_deleted', true),
  ('audit_module_change', true),
  ('audit_field_change', true),
  ('enforce_attachment_cap', true),
  ('audit_attachment_change', true),
  ('enqueue_attachment_object_deletion', true);

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
  30,
  'migrations 001 to 005 define exactly thirty functions in public'
);

select * from finish();
rollback;
