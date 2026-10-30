-- 04: cross-workspace isolation on public.invitations.
-- One pending invitation per workspace is inserted as postgres inside the
-- transaction. Covers the four section 7 matrix cells for `invitations` both
-- ways. Update is denied outright (no grant: accepting is an Edge Function).
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
create function tests.ws_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;
create function tests.inv_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000a001'::uuid $$;
create function tests.inv_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b001'::uuid $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into public.invitations (id, workspace_id, email, role, invited_by)
values (tests.inv_a(), tests.ws_a(), 'invitee-a@example.com', 'member', tests.alice()),
       (tests.inv_b(), tests.ws_b(), 'invitee-b@example.com', 'member', tests.bob());

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.invitations where workspace_id = tests.ws_b()), 0,
  'alice: select of workspace B invitations returns 0 rows');
select results_eq(
  'select id from public.invitations',
  array[tests.inv_a()],
  'alice: sees exactly the workspace A invitation'
);

select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, invited_by) values (%L, 'x@example.com', %L)$sql$,
         tests.ws_b(), tests.alice()),
  '42501',
  'new row violates row-level security policy for table "invitations"',
  'alice: insert of an invitation with workspace B id is rejected by RLS'
);
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, invited_by) values (%L, 'x@example.com', %L)$sql$,
         tests.ws_b(), tests.bob()),
  '42501',
  null,
  'alice: insert of an invitation with workspace B id and bob as inviter is rejected by RLS'
);

select throws_ok(
  format($sql$update public.invitations set accepted_at = now() where id = %L$sql$, tests.inv_b()),
  '42501',
  'permission denied for table invitations',
  'alice: update of a workspace B invitation is denied (no update grant)'
);
select throws_ok(
  format($sql$update public.invitations set accepted_at = now() where id = %L$sql$, tests.inv_a()),
  '42501',
  'permission denied for table invitations',
  'alice: update of her own workspace invitation is denied too (accept goes through an Edge Function)'
);

select is(
  tests.rows_affected(format($sql$delete from public.invitations where id = %L$sql$, tests.inv_b())),
  0, 'alice: delete of the workspace B invitation affects 0 rows');
select is(
  tests.rows_affected(format($sql$delete from public.invitations where workspace_id = %L$sql$, tests.ws_b())),
  0, 'alice: delete of all workspace B invitations affects 0 rows');

select tests.logout();
select is((select count(*)::int from public.invitations where id = tests.inv_b() and accepted_at is null), 1,
  'postgres: workspace B invitation is untouched after alice''s attempts');
select is((select count(*)::int from public.invitations), 2,
  'postgres: both invitations still exist');

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());

select is((select count(*)::int from public.invitations where workspace_id = tests.ws_a()), 0,
  'bob: select of workspace A invitations returns 0 rows');
select results_eq(
  'select id from public.invitations',
  array[tests.inv_b()],
  'bob: sees exactly the workspace B invitation'
);

select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, invited_by) values (%L, 'x@example.com', %L)$sql$,
         tests.ws_a(), tests.bob()),
  '42501',
  null,
  'bob: insert of an invitation with workspace A id is rejected by RLS'
);
select throws_ok(
  format($sql$update public.invitations set accepted_at = now() where id = %L$sql$, tests.inv_a()),
  '42501',
  'permission denied for table invitations',
  'bob: update of a workspace A invitation is denied'
);
select is(
  tests.rows_affected(format($sql$delete from public.invitations where id = %L$sql$, tests.inv_a())),
  0, 'bob: delete of the workspace A invitation affects 0 rows');

-- Positive control: an owner can revoke its own workspace's invitation.
select is(
  tests.rows_affected(format($sql$delete from public.invitations where id = %L$sql$, tests.inv_b())),
  1, 'bob: delete of his own workspace B invitation affects 1 row');

select tests.logout();
select is((select count(*)::int from public.invitations where id = tests.inv_a()), 1,
  'postgres: workspace A invitation is untouched after bob''s attempts');
select is((select count(*)::int from public.invitations where id = tests.inv_b()), 0,
  'postgres: bob''s revoke of the workspace B invitation was applied');

select * from finish();
rollback;
