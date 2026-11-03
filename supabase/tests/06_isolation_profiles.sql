-- 06: isolation on public.profiles.
-- A user sees their own profile and the profiles of people they share a
-- workspace with, nothing else. Only the own row is updatable, and only
-- full_name / avatar_url. Nobody inserts or deletes profiles directly.
--
-- Independent of pre-existing rows: visibility is asserted as set equality
-- between the profiles the caller sees and the members of the workspaces the
-- caller belongs to (both read under RLS), plus the specific other user, before
-- and after bob joins and leaves A. No count of seed rows is assumed.
create extension if not exists pgtap with schema extensions;

begin;
select plan(19);
\ir helpers/tests_schema.sql.inc

select tests.remember_text('bob_name', (select full_name from public.profiles where id = tests.bob()));

-- ---------------------------------------------------------------------------
-- Alice, sharing no workspace with bob
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select results_eq(
  'select id from public.profiles order by id',
  'select distinct user_id from public.workspace_members order by user_id',
  'alice: sees exactly the profiles of the members of her own workspaces');
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
  'select id from public.profiles order by id',
  'select distinct user_id from public.workspace_members order by user_id',
  'bob: sees exactly the profiles of the members of his own workspaces');
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
select results_eq(
  'select id from public.profiles order by id',
  'select distinct user_id from public.workspace_members order by user_id',
  'alice: still sees exactly the profiles of the members of her workspaces once bob shares workspace A');
select is((select count(*)::int from public.profiles where id = tests.bob()), 1,
  'alice: sees bob''s profile once they share a workspace');
select is(
  tests.rows_affected(format($sql$update public.profiles set full_name = 'Pwned' where id = %L$sql$, tests.bob())),
  0, 'alice: still cannot update bob''s profile after sharing a workspace');

select tests.logout();
select tests.login_as(tests.bob());
select results_eq(
  'select id from public.profiles order by id',
  'select distinct user_id from public.workspace_members order by user_id',
  'bob: sees exactly the profiles of the members of his workspaces once he shares workspace A');
select is((select count(*)::int from public.profiles where id = tests.alice()), 1,
  'bob: sees alice''s profile once they share a workspace');

-- ---------------------------------------------------------------------------
-- Bob leaves workspace A: visibility is revoked again
-- ---------------------------------------------------------------------------
select tests.logout();
delete from public.workspace_members where workspace_id = tests.ws_a() and user_id = tests.bob();

select tests.login_as(tests.alice());
select is((select count(*)::int from public.profiles where id = tests.bob()), 0,
  'alice: no longer sees bob''s profile after he left workspace A');
select results_eq(
  'select id from public.profiles order by id',
  'select distinct user_id from public.workspace_members order by user_id',
  'alice: again sees exactly the profiles of the members of her workspaces after bob left');

select tests.logout();
select is((select full_name from public.profiles where id = tests.bob()), tests.recall_text('bob_name'),
  'postgres: bob''s full_name is untouched');
select is((select full_name from public.profiles where id = tests.alice()), 'Alice Updated',
  'postgres: alice''s own update was applied');

select * from finish();
rollback;
