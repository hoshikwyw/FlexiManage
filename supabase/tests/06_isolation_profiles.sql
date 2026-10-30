-- 06: isolation on public.profiles.
-- A user sees their own profile and the profiles of people they share a
-- workspace with, nothing else. Only the own row is updatable, and only
-- full_name / avatar_url. Nobody inserts or deletes profiles directly.
create extension if not exists pgtap with schema extensions;

begin;
select plan(18);

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

-- ---------------------------------------------------------------------------
-- Alice, sharing no workspace with bob
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select results_eq(
  'select id from public.profiles',
  array[tests.alice()],
  'alice: sees only her own profile'
);
select is((select count(*)::int from public.profiles where id = tests.bob()), 0,
  'alice: select of bob''s profile returns 0 rows');

select is(
  tests.rows_affected(format($sql$update public.profiles set full_name = 'Alice Updated' where id = %L$sql$, tests.alice())),
  1, 'alice: update of her own full_name affects 1 row');
select is(
  tests.rows_affected(format($sql$update public.profiles set full_name = 'Pwned' where id = %L$sql$, tests.bob())),
  0, 'alice: update of bob''s profile affects 0 rows');
select throws_ok(
  format($sql$update public.profiles set email = 'new@example.com' where id = %L$sql$, tests.alice()),
  '42501',
  'permission denied for table profiles',
  'alice: update of her own email column is denied (column grant)'
);
select throws_ok(
  format($sql$insert into public.profiles (id, email) values (%L, 'ghost@example.com')$sql$,
         '00000000-0000-0000-0000-0000000000ff'),
  '42501',
  'permission denied for table profiles',
  'alice: insert into profiles is denied'
);
select throws_ok(
  format($sql$delete from public.profiles where id = %L$sql$, tests.alice()),
  '42501',
  'permission denied for table profiles',
  'alice: delete of her own profile is denied'
);

-- ---------------------------------------------------------------------------
-- Bob, mirrored
-- ---------------------------------------------------------------------------
select tests.logout();
select tests.login_as(tests.bob());

select results_eq(
  'select id from public.profiles',
  array[tests.bob()],
  'bob: sees only his own profile'
);
select is((select count(*)::int from public.profiles where id = tests.alice()), 0,
  'bob: select of alice''s profile returns 0 rows');
select is(
  tests.rows_affected(format($sql$update public.profiles set full_name = 'Pwned' where id = %L$sql$, tests.alice())),
  0, 'bob: update of alice''s profile affects 0 rows');

-- ---------------------------------------------------------------------------
-- Bob joins workspace A: the two now see each other, still cannot edit
-- ---------------------------------------------------------------------------
select tests.logout();
insert into public.workspace_members (workspace_id, user_id, role)
values (tests.ws_a(), tests.bob(), 'member');

select tests.login_as(tests.alice());
select is((select count(*)::int from public.profiles), 2,
  'alice: sees two profiles once bob shares workspace A');
select is((select count(*)::int from public.profiles where id = tests.bob()), 1,
  'alice: sees bob''s profile once they share a workspace');
select is(
  tests.rows_affected(format($sql$update public.profiles set full_name = 'Pwned' where id = %L$sql$, tests.bob())),
  0, 'alice: still cannot update bob''s profile after sharing a workspace');

select tests.logout();
select tests.login_as(tests.bob());
select is((select count(*)::int from public.profiles), 2,
  'bob: sees two profiles once he shares workspace A');
select is((select count(*)::int from public.profiles where id = tests.alice()), 1,
  'bob: sees alice''s profile once they share a workspace');

-- ---------------------------------------------------------------------------
-- Bob leaves workspace A: visibility is revoked again
-- ---------------------------------------------------------------------------
select tests.logout();
delete from public.workspace_members where workspace_id = tests.ws_a() and user_id = tests.bob();

select tests.login_as(tests.alice());
select results_eq(
  'select id from public.profiles',
  array[tests.alice()],
  'alice: sees only herself again after bob left workspace A'
);

select tests.logout();
select is((select full_name from public.profiles where id = tests.bob()), 'Bob Example',
  'postgres: bob''s full_name is untouched');
select is((select full_name from public.profiles where id = tests.alice()), 'Alice Updated',
  'postgres: alice''s own update was applied');

select * from finish();
rollback;
