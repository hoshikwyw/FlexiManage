-- 03: cross-workspace isolation on public.workspace_members.
-- The critical case: a user must not be able to insert themselves into a
-- workspace they do not belong to, nor see, change or remove its members.
-- Covers the four section 7 matrix cells for `workspace_members` both ways.
create extension if not exists pgtap with schema extensions;

begin;
select plan(17);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login_as(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function tests.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

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

create function tests.alice() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create function tests.bob() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000b'::uuid $$;
create function tests.ws_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function tests.ws_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_b()), 0,
  'alice: select of workspace B members returns 0 rows');
select results_eq(
  'select workspace_id, user_id from public.workspace_members',
  format('values (%L::uuid, %L::uuid)', tests.ws_a(), tests.alice()),
  'alice: sees exactly her own membership in workspace A'
);

select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_b(), tests.alice()),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
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
  format('select user_id, role from public.workspace_members where workspace_id = %L', tests.ws_b()),
  format($sql$values (%L::uuid, 'owner'::public.workspace_role)$sql$, tests.bob()),
  'postgres: workspace B still has exactly bob as owner'
);
select is((select count(*)::int from public.workspace_members where user_id = tests.alice()), 1,
  'postgres: alice still has exactly one membership (workspace A)');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a()), 0,
  'bob: select of workspace A members returns 0 rows');
select results_eq(
  'select workspace_id, user_id from public.workspace_members',
  format('values (%L::uuid, %L::uuid)', tests.ws_b(), tests.bob()),
  'bob: sees exactly his own membership in workspace B'
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
  format('select user_id, role from public.workspace_members where workspace_id = %L', tests.ws_a()),
  format($sql$values (%L::uuid, 'owner'::public.workspace_role)$sql$, tests.alice()),
  'postgres: workspace A still has exactly alice as owner'
);

select * from finish();
rollback;
