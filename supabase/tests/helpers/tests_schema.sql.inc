-- Shared pgTAP helpers, included by every supabase/tests/NN_*.sql file with
--   \ir helpers/tests_schema.sql.inc
-- right after `begin; select plan(N);`. Everything lives in the `tests` schema
-- and is rolled back with the test transaction. The .sql.inc extension keeps
-- pg_prove (which collects *.sql) from running this file on its own.
--
-- Rules the suite relies on (docs/operations.md, "Database tests"):
--   * the only seed facts assumed are that workspaces A and B exist, alice is
--     the owner of A and not a member of B, bob is the owner of B and not a
--     member of A; everything else (extra users, workspaces, invitations,
--     audit rows) may already be present, so assertions are made on fixtures
--     created inside the transaction or as deltas against captured counts.
--   * `now()` is frozen for the whole transaction, so `created_at >= now()`
--     selects exactly the rows a test file created itself.

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Impersonate a signed-in user the way PostgREST does: role + JWT claims.
create function tests.login_as(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Browser without a session.
create function tests.login_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- Back to postgres (bypasses RLS) with no JWT claims.
create function tests.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Runs a DML statement as the current role and returns the affected row count.
create function tests.rows_affected(p_sql text) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Minimal auth.users row; the on_auth_user_created trigger adds the profile.
-- p_confirmed = false leaves email_confirmed_at null (accept_invitation PT403);
-- p_avatar feeds raw_user_meta_data.avatar_url for the handle_new_user checks.
create function tests.create_user(
  p_id uuid, p_email text, p_full_name text,
  p_confirmed boolean default true, p_avatar text default null
) returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          '{"provider": "email", "providers": ["email"]}'::jsonb,
          jsonb_strip_nulls(jsonb_build_object('full_name', p_full_name, 'avatar_url', p_avatar)),
          case when p_confirmed then now() end, now(), now());
end;
$$;

-- Capture a count or a text value under a transaction-local name and read it
-- back later, also while impersonating: the "before" side of a delta assertion.
create function tests.remember_count(p_name text, p_value bigint) returns void
language sql as $$
  select set_config('tests.' || p_name, p_value::text, true)
$$;
create function tests.recall_count(p_name text) returns integer
language sql stable as $$
  select nullif(current_setting('tests.' || p_name, true), '')::integer
$$;
create function tests.remember_text(p_name text, p_value text) returns void
language sql as $$
  select set_config('tests.' || p_name, coalesce(p_value, ''), true)
$$;
create function tests.recall_text(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('tests.' || p_name, true), '')
$$;

-- Current role of a user in a workspace, as text, readable while impersonating
-- (security definer, owned by postgres).
create function tests.role_in(p_ws uuid, p_user_id uuid) returns text
language sql security definer set search_path = '' as $$
  select m.role::text from public.workspace_members m
  where m.workspace_id = p_ws and m.user_id = p_user_id
$$;

-- Token of an invitation, readable while impersonating (the column is hidden
-- from authenticated by migration 003).
create function tests.token_of(p_id uuid) returns text
language sql security definer set search_path = '' as $$
  select i.token from public.invitations i where i.id = p_id
$$;

-- Fixed seed ids from supabase/seed.sql / tests/fixtures/ids.ts.
create function tests.alice() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create function tests.bob() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000b'::uuid $$;
create function tests.ws_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function tests.ws_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;

-- Fixed ids for users created inside a test transaction (tests.create_user).
create function tests.carol() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000c'::uuid $$;
create function tests.dave() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000d'::uuid $$;
create function tests.erin() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000e'::uuid $$;
create function tests.frank() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000f'::uuid $$;
create function tests.grace() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-000000000010'::uuid $$;

-- Seed invariants every file relies on. Fail loudly and early when the local
-- database no longer matches supabase/seed.sql (run `npm run db:reset`).
create function tests.assert_seed_invariants() returns setof text
language plpgsql as $$
begin
  if (select count(*) from public.workspaces where id in (tests.ws_a(), tests.ws_b())) <> 2 then
    raise exception 'seed invariant violated: workspaces A and B must exist (npm run db:reset)';
  end if;
  if tests.role_in(tests.ws_a(), tests.alice()) is distinct from 'owner'
     or tests.role_in(tests.ws_b(), tests.bob()) is distinct from 'owner' then
    raise exception 'seed invariant violated: alice must own A and bob must own B (npm run db:reset)';
  end if;
  if tests.role_in(tests.ws_b(), tests.alice()) is not null
     or tests.role_in(tests.ws_a(), tests.bob()) is not null then
    raise exception 'seed invariant violated: alice must not be in B and bob must not be in A (npm run db:reset)';
  end if;
  return;
end;
$$;
select tests.assert_seed_invariants();

-- Plan limits (migration 007). Files 02 to 21 test isolation, roles and the
-- content rules, not plan limits, and their fixtures need more than the Free
-- limits allow (extra members, modules, workspaces owned by alice and bob). The
-- seed workspaces are put on Business for the duration of the transaction
-- (whatever plan a manual session left them on); the subscription.* audit rows
-- this writes are removed again so audit assertions only see the test's own
-- rows. 22_plans_and_entitlements.sql tests the limits on its own workspaces.
-- Fixtures inserted as postgres are never checked (entitlement_check_bypassed).
update public.subscriptions
   set plan_key = 'business', status = 'active'
 where workspace_id in (tests.ws_a(), tests.ws_b())
   and (plan_key <> 'business' or status <> 'active');
delete from public.audit_events
 where workspace_id in (tests.ws_a(), tests.ws_b())
   and action like 'subscription.%'
   and created_at >= now();

-- ---------------------------------------------------------------------------
-- Content fixtures (migration 004). Tests never rely on the seed module,
-- fields or records; they create their own inside the transaction with the
-- fixed ids below (distinct from the seed ids 0a0001 / 0b0001 / 0f000N / 0e000N).
-- ---------------------------------------------------------------------------
-- TEST-ONLY GRANT. Migration 006 removed `id` from the insert grants of
-- modules, field_definitions and records (clients never choose ids). The
-- fixture helpers below insert the fixed ids while impersonating so that RLS
-- is exercised with predictable rows; this grant restores exactly that one
-- column for the duration of the test transaction (rolled back with it).
-- 01_rls_enabled.sql (which does not include this file) and
-- 21_phase3_fixes.sql (which revokes it first) assert the real grants.
grant insert (id) on table public.modules, public.field_definitions, public.records to authenticated;

-- Modules created by tests: one in A, one in B.
create function tests.mod_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0a1'::uuid $$;
create function tests.mod_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0b1'::uuid $$;
-- Fields created by tests (module A unless the name says otherwise).
create function tests.fld_a1() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0f1'::uuid $$;
create function tests.fld_a2() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0f2'::uuid $$;
create function tests.fld_a3() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0f3'::uuid $$;
create function tests.fld_a4() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0f4'::uuid $$;
create function tests.fld_a5() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0f5'::uuid $$;
create function tests.fld_a6() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0f6'::uuid $$;
create function tests.fld_b1() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0fb'::uuid $$;
-- Records created by tests.
create function tests.rec_a1() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0e1'::uuid $$;
create function tests.rec_a2() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0e2'::uuid $$;
create function tests.rec_a3() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0e3'::uuid $$;
create function tests.rec_b1() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c0eb'::uuid $$;

-- Insert a module as the current role (call as postgres for fixtures, or while
-- impersonating to go through RLS). created_by defaults to the workspace owner
-- (alice for A, bob for B) when not given.
create function tests.create_module(p_id uuid, p_ws uuid, p_slug text, p_created_by uuid default null)
returns void language plpgsql as $$
begin
  insert into public.modules (id, workspace_id, name, slug, created_by)
  values (p_id, p_ws, initcap(replace(p_slug, '-', ' ')), p_slug,
          coalesce(p_created_by, case when p_ws = tests.ws_b() then tests.bob() else tests.alice() end));
end;
$$;

-- Insert a field definition as the current role. workspace_id is taken from
-- the module (as postgres) unless p_ws overrides it (to test the composite FK).
create function tests.create_field(
  p_id uuid, p_module uuid, p_key text, p_type public.field_type,
  p_required boolean default false, p_options jsonb default '[]'::jsonb,
  p_settings jsonb default '{}'::jsonb, p_position integer default 0, p_ws uuid default null
) returns void language plpgsql as $$
begin
  insert into public.field_definitions (id, workspace_id, module_id, key, label, type, required, position, options, settings)
  values (p_id, coalesce(p_ws, tests.module_workspace(p_module)), p_module, p_key, initcap(replace(p_key, '_', ' ')),
          p_type, p_required, p_position, p_options, p_settings);
end;
$$;

-- Workspace of a module, readable while impersonating.
create function tests.module_workspace(p_module uuid) returns uuid
language sql security definer set search_path = '' as $$
  select m.workspace_id from public.modules m where m.id = p_module
$$;

-- Insert a record as the current role. created_by defaults to the workspace
-- owner when not given.
create function tests.create_record(
  p_id uuid, p_module uuid, p_title text, p_values jsonb default '{}'::jsonb,
  p_created_by uuid default null, p_ws uuid default null, p_status text default null
) returns void language plpgsql as $$
declare
  v_ws uuid := coalesce(p_ws, tests.module_workspace(p_module));
begin
  insert into public.records (id, workspace_id, module_id, title, status, custom_values, created_by)
  values (p_id, v_ws, p_module, p_title, p_status, p_values,
          coalesce(p_created_by, case when v_ws = tests.ws_b() then tests.bob() else tests.alice() end));
end;
$$;

-- custom_values of a record, readable while impersonating (for "unchanged" checks).
create function tests.values_of(p_record uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select r.custom_values from public.records r where r.id = p_record
$$;

-- ---------------------------------------------------------------------------
-- Attachment fixtures (migration 005). attachments.id is not insertable by
-- clients (column grant), so the helpers return the generated id; tests keep
-- it with tests.remember_text(). Run as postgres for fixtures (then
-- p_uploaded_by is required, there is no auth.uid()), or while impersonating
-- to go through RLS (then uploaded_by defaults to auth.uid()).
-- ---------------------------------------------------------------------------
create function tests.create_attachment(
  p_record uuid, p_file_name text, p_uploaded_by uuid default null,
  p_size bigint default 100, p_content_type text default 'text/plain', p_ws uuid default null
) returns uuid language plpgsql as $$
declare
  v_ws uuid := coalesce(p_ws, tests.record_workspace(p_record));
  v_id uuid;
begin
  if p_uploaded_by is null then
    insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes)
    values (v_ws, p_record, p_file_name, p_content_type, p_size)
    returning id into v_id;
  else
    insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes, uploaded_by)
    values (v_ws, p_record, p_file_name, p_content_type, p_size, p_uploaded_by)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Workspace of a record, readable while impersonating.
create function tests.record_workspace(p_record uuid) returns uuid
language sql security definer set search_path = '' as $$
  select r.workspace_id from public.records r where r.id = p_record
$$;

-- storage_path of an attachment, readable while impersonating (also after RLS
-- would hide the row).
create function tests.path_of(p_attachment uuid) returns text
language sql security definer set search_path = '' as $$
  select a.storage_path from public.attachments a where a.id = p_attachment
$$;

-- Insert a storage object in the attachments bucket as the current role, the
-- way storage-api does after an upload (owner = caller, metadata with size and
-- mimetype). p_metadata null mimics the pre-upload check (can_insert_object).
create function tests.put_object(p_name text, p_metadata jsonb default null) returns void
language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('attachments', p_name, auth.uid(), auth.uid()::text, p_metadata);
end;
$$;

-- Metadata storage-api writes for an uploaded object.
create function tests.object_meta(p_size bigint, p_mimetype text default 'text/plain') returns jsonb
language sql immutable as $$
  select jsonb_build_object('size', p_size, 'mimetype', p_mimetype, 'contentLength', p_size,
                            'httpStatusCode', 200, 'cacheControl', 'no-cache')
$$;

-- storage-api sets this before every delete; storage.protect_delete() refuses
-- direct deletes from storage.objects otherwise.
create function tests.allow_storage_delete() returns void
language sql as $$
  select set_config('storage.allow_delete_query', 'true', true)
$$;
