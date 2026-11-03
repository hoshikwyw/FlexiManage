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
