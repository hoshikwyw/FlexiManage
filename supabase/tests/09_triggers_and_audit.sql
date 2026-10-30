-- 09: triggers and audit events.
--   * auth.users insert creates the profile
--   * workspace insert makes the creator owner and writes workspace.created
--     and member.added
--   * invitation insert/delete writes invitation.created/revoked without the token
--   * role change writes member.role_changed, removal writes member.removed
--   * updated_at is stamped on update
create extension if not exists pgtap with schema extensions;

begin;
select plan(23);

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
create function tests.carol() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000c'::uuid $$;
create function tests.ws_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function tests.ws_c() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000cc'::uuid $$;
create function tests.inv_c() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000c001'::uuid $$;

-- ---------------------------------------------------------------------------
-- auth.users insert creates the profile (as postgres)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profiles where id = tests.carol()), 0,
  'no profile exists before the auth.users row');
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
select results_eq(
  format('select email, full_name from public.profiles where id = %L', tests.carol()),
  $$values ('carol@example.com', 'Carol Example')$$,
  'inserting an auth.users row creates the matching profile with email and full_name'
);

-- ---------------------------------------------------------------------------
-- Workspace creation as alice
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is(tests.rows_affected(format($sql$insert into public.workspaces (id, name, slug, created_by) values (%L, 'Workspace C', 'workspace-c', %L)$sql$,
                                     tests.ws_c(), tests.alice())),
  1, 'alice: creates workspace C in one statement');
select results_eq(
  format('select user_id, role::text from public.workspace_members where workspace_id = %L', tests.ws_c()),
  format($sql$values (%L::uuid, 'owner')$sql$, tests.alice()),
  'alice is the sole owner of the new workspace');
select results_eq(
  format($sql$select actor_id, entity_type, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'workspace.created'$sql$, tests.ws_c()),
  format($sql$values (%L::uuid, 'workspace', %L::text, '{"name": "Workspace C", "slug": "workspace-c"}'::jsonb)$sql$,
         tests.alice(), tests.ws_c()),
  'workspace.created is written with alice as actor and name/slug metadata');
select results_eq(
  format($sql$select actor_id, entity_type, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'member.added'$sql$, tests.ws_c()),
  format($sql$values (%L::uuid, 'workspace_member', %L::text, '{"role": "owner"}'::jsonb)$sql$,
         tests.alice(), tests.alice()),
  'member.added is written for the owner membership');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_c()), 2,
  'exactly two audit events exist for the new workspace');

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
select is(tests.rows_affected(format($sql$insert into public.invitations (id, workspace_id, email, role, invited_by) values (%L, %L, 'invitee@example.com', 'member', %L)$sql$,
                                     tests.inv_c(), tests.ws_c(), tests.alice())),
  1, 'alice: creates an invitation');
select results_eq(
  format($sql$select actor_id, entity_type, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'invitation.created'$sql$, tests.ws_c()),
  format($sql$values (%L::uuid, 'invitation', %L::text, '{"role": "member", "email": "invitee@example.com"}'::jsonb)$sql$,
         tests.alice(), tests.inv_c()),
  'invitation.created carries only email and role in metadata');
select ok(
  not exists (
    select 1 from public.audit_events ae
    join public.invitations i on i.id::text = ae.entity_id
    where ae.workspace_id = tests.ws_c()
      and ae.action = 'invitation.created'
      and (ae.metadata ? 'token' or ae.metadata::text like '%' || i.token || '%')
  ),
  'the invitation token never appears in the audit log');

select is(tests.rows_affected(format($sql$delete from public.invitations where id = %L$sql$, tests.inv_c())),
  1, 'alice: revokes the invitation');
select results_eq(
  format($sql$select actor_id, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'invitation.revoked'$sql$, tests.ws_c()),
  format($sql$values (%L::uuid, %L::text, '{"role": "member", "email": "invitee@example.com", "accepted": false}'::jsonb)$sql$,
         tests.alice(), tests.inv_c()),
  'invitation.revoked is written with accepted = false');

-- ---------------------------------------------------------------------------
-- Membership changes
-- ---------------------------------------------------------------------------
select is(tests.rows_affected(format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
                                     tests.ws_c(), tests.carol())),
  1, 'alice: adds carol as member');
select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
             where workspace_id = %L and action = 'member.added' and entity_id = %L$sql$, tests.ws_c(), tests.carol()::text),
  format($sql$values (%L::uuid, '{"role": "member"}'::jsonb)$sql$, tests.alice()),
  'member.added is written for carol with alice as actor');

select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_c(), tests.carol())),
  1, 'alice: promotes carol to admin');
select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
             where workspace_id = %L and action = 'member.role_changed' and entity_id = %L$sql$, tests.ws_c(), tests.carol()::text),
  format($sql$values (%L::uuid, '{"to": "admin", "from": "member"}'::jsonb)$sql$, tests.alice()),
  'member.role_changed is written with from/to metadata');

select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_c(), tests.carol())),
  1, 'alice: re-saves carol with the same role');
select is((select count(*)::int from public.audit_events
           where workspace_id = tests.ws_c() and action = 'member.role_changed'), 1,
  'an update that does not change the role writes no member.role_changed event');

select is(tests.rows_affected(format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_c(), tests.carol())),
  1, 'alice: removes carol');
select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
             where workspace_id = %L and action = 'member.removed' and entity_id = %L$sql$, tests.ws_c(), tests.carol()::text),
  format($sql$values (%L::uuid, '{"role": "admin"}'::jsonb)$sql$, tests.alice()),
  'member.removed is written with the role held at removal');

-- ---------------------------------------------------------------------------
-- updated_at (seed rows were written in an earlier transaction, so now() differs)
-- ---------------------------------------------------------------------------
-- The seed rows have created_at = updated_at from the seed transaction.
select tests.rows_affected(format($sql$update public.workspaces set name = 'Workspace A renamed' where id = %L$sql$, tests.ws_a()));
select ok(
  (select updated_at = now() and updated_at > created_at from public.workspaces where id = tests.ws_a()),
  'workspaces.updated_at is stamped on update');

select tests.rows_affected(format($sql$update public.profiles set full_name = 'Alice Renamed' where id = %L$sql$, tests.alice()));
select ok(
  (select updated_at = now() and updated_at > created_at from public.profiles where id = tests.alice()),
  'profiles.updated_at is stamped on update');

select tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                  tests.ws_a(), tests.alice()));
select ok(
  (select updated_at = now() and updated_at > created_at from public.workspace_members
   where workspace_id = tests.ws_a() and user_id = tests.alice()),
  'workspace_members.updated_at is stamped on update');

select tests.logout();
select * from finish();
rollback;
