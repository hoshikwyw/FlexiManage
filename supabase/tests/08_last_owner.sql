-- 08: the last-owner guard (protect_last_owner trigger) and workspace delete.
-- A workspace always keeps at least one owner, except when the workspace
-- itself is deleted (the cascade is let through).
create extension if not exists pgtap with schema extensions;

begin;
select plan(16);

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

create function tests.create_user(p_id uuid, p_email text, p_full_name text) returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          '{"provider": "email", "providers": ["email"]}'::jsonb,
          jsonb_build_object('full_name', p_full_name), now(), now(), now());
end;
$$;

create function tests.alice() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create function tests.bob() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000b'::uuid $$;
create function tests.carol() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000c'::uuid $$;
create function tests.ws_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function tests.ws_b() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$;

create function tests.role_in_a(p_user_id uuid) returns text
language sql security definer set search_path = '' as $$
  select m.role::text from public.workspace_members m
  where m.workspace_id = '00000000-0000-0000-0000-0000000000aa' and m.user_id = p_user_id
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
insert into public.workspace_members (workspace_id, user_id, role)
values (tests.ws_a(), tests.carol(), 'member');
insert into public.invitations (workspace_id, email, invited_by)
values (tests.ws_b(), 'invitee-b@example.com', tests.bob());

-- ---------------------------------------------------------------------------
-- alice is the sole owner of A
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select throws_like(
  format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.alice()),
  'cannot remove or demote the last owner of workspace %',
  'sole owner: demoting herself fails');
select throws_like(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.alice()),
  'cannot remove or demote the last owner of workspace %',
  'sole owner: leaving fails');

select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.carol())),
  1, 'sole owner: promoting carol to owner succeeds');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'with a second owner: demoting the first owner succeeds');

select tests.logout();
select is(tests.role_in_a(tests.alice()), 'member', 'postgres: alice is now a member of A');
select is(tests.role_in_a(tests.carol()), 'owner',  'postgres: carol is now the owner of A');

-- ---------------------------------------------------------------------------
-- carol is now the sole owner
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());

select throws_ok(
  format($sql$update public.workspace_members set role = 'member' where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.carol()),
  'P0001', null,
  'new sole owner: demoting herself fails with P0001');
select throws_ok(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.carol()),
  'P0001', null,
  'new sole owner: leaving fails with P0001');
select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'new sole owner: removing the demoted former owner (now a member) succeeds');

-- The guard is a trigger, so it also binds roles that bypass RLS.
select tests.logout();
select throws_like(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.carol()),
  'cannot remove or demote the last owner of workspace %',
  'postgres: the guard applies even when RLS is bypassed');

-- ---------------------------------------------------------------------------
-- Deleting the workspace as owner succeeds despite the guard (cascade)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.bob());
select is(tests.rows_affected(format($sql$delete from public.workspaces where id = %L$sql$, tests.ws_b())),
  1, 'owner: deleting the workspace succeeds although bob is its last owner');

select tests.logout();
select is((select count(*)::int from public.workspaces where id = tests.ws_b()), 0,
  'postgres: workspace B is gone');
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_b()), 0,
  'postgres: workspace B memberships were cascaded');
select is((select count(*)::int from public.invitations where workspace_id = tests.ws_b()), 0,
  'postgres: workspace B invitations were cascaded');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_b()), 0,
  'postgres: workspace B audit events were cascaded');
select is((select count(*)::int from public.workspace_members where user_id = tests.bob()), 0,
  'postgres: bob has no membership left');

select * from finish();
rollback;
