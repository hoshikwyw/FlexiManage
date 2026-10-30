-- 02: cross-workspace isolation on public.workspaces.
-- Alice owns Workspace A, Bob owns Workspace B (supabase/seed.sql). Neither is
-- a member of the other's workspace. Covers the four cells of the
-- docs/PLANNING.md section 7 matrix for `workspaces` in both directions.
create extension if not exists pgtap with schema extensions;

begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

-- Impersonate a signed-in user the way PostgREST does: role + JWT claims.
create function tests.login_as(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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

-- Fixed ids from tests/fixtures/ids.ts
create function tests.alice() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create function tests.bob() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000b'::uuid $$;
create function tests.ws_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function tests.ws_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;

-- Sanity: the seed is in place.
select is((select count(*)::int from public.workspaces where id in (tests.ws_a(), tests.ws_b())), 2,
  'seed: both workspaces exist');

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.workspaces where id = tests.ws_b()), 0,
  'alice: select of workspace B returns 0 rows');
select results_eq(
  'select id from public.workspaces',
  array[tests.ws_a()],
  'alice: sees exactly workspace A'
);

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
  tests.rows_affected(format($sql$update public.workspaces set slug = 'pwned-b' where slug = 'workspace-b'$sql$)),
  0, 'alice: update of workspace B by slug affects 0 rows');

select is(
  tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_b())),
  0, 'alice: delete of workspace B affects 0 rows');
select is(
  tests.rows_affected('delete from public.workspaces'),
  1, 'alice: unscoped delete only reaches her own workspace A');

select tests.logout();
select is((select name from public.workspaces where id = tests.ws_b()), 'Workspace B',
  'postgres: workspace B is untouched after alice''s attempts');
select is((select count(*)::int from public.workspaces where id = tests.ws_a()), 0,
  'postgres: alice''s unscoped delete removed only workspace A');

-- Restore A for the mirrored run (as postgres, trigger re-adds alice as owner).
insert into public.workspaces (id, name, slug, created_by)
values (tests.ws_a(), 'Workspace A', 'workspace-a', tests.alice());

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.workspaces where id = tests.ws_a()), 0,
  'bob: select of workspace A returns 0 rows');
select results_eq(
  'select id from public.workspaces',
  array[tests.ws_b()],
  'bob: sees exactly workspace B'
);

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

-- Positive control: a member can read, an owner can rename and delete its own.
select is(
  tests.rows_affected(format($sql$update public.workspaces set name = 'Workspace B renamed' where id = %L$sql$, tests.ws_b())),
  1, 'bob: update of his own workspace B affects 1 row');

select tests.logout();
select is((select name from public.workspaces where id = tests.ws_a()), 'Workspace A',
  'postgres: workspace A is untouched after bob''s attempts');
select is((select name from public.workspaces where id = tests.ws_b()), 'Workspace B renamed',
  'postgres: bob''s rename of workspace B was applied');

select * from finish();
rollback;
