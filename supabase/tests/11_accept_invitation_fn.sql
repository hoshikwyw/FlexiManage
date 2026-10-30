-- 11: public.accept_invitation(p_token) from migration 002.
--   * grants: authenticated only (anon and service_role are denied)
--   * PT401 without a user, PT404 unknown token, PT403 wrong email or unverified
--     email, PT410 expired, PT404 already used (one-shot token)
--   * happy path: membership with the invited role, accepted_at stamped,
--     invitation.accepted and member.added audit rows with the caller as actor,
--     token never in audit metadata, email matched case-insensitively
--   * already a member: role kept, invitation consumed, no extra member.added
-- Fixtures created as postgres inside the transaction:
--   carol  no membership, confirmed email      erin  no membership, unconfirmed email
--   invitations in A: inv_ok (Carol, admin), inv_expired, inv_used, inv_dave,
--   inv_erin, inv_alice (alice is already owner of A)
create extension if not exists pgtap with schema extensions;

begin;
select plan(32);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login_as(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function tests.login_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

create function tests.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function tests.create_user(p_id uuid, p_email text, p_full_name text, p_confirmed boolean default true)
returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          '{"provider": "email", "providers": ["email"]}'::jsonb,
          jsonb_build_object('full_name', p_full_name),
          case when p_confirmed then now() end, now(), now());
end;
$$;

create function tests.alice() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create function tests.carol() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000c'::uuid $$;
create function tests.dave() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000d'::uuid $$;
create function tests.erin() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000000e'::uuid $$;
create function tests.ws_a() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function tests.inv_ok() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b001'::uuid $$;
create function tests.inv_expired() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b002'::uuid $$;
create function tests.inv_used() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b003'::uuid $$;
create function tests.inv_dave() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b004'::uuid $$;
create function tests.inv_erin() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b005'::uuid $$;
create function tests.inv_alice() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-00000000b006'::uuid $$;

-- Token of an invitation, readable while impersonating (security definer).
create function tests.token_of(p_id uuid) returns text
language sql security definer set search_path = '' as $$
  select i.token from public.invitations i where i.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
select tests.create_user(tests.dave(),  'dave@example.com',  'Dave Example');
select tests.create_user(tests.erin(),  'erin@example.com',  'Erin Example', false);

insert into public.invitations (id, workspace_id, email, role, invited_by, token, expires_at, accepted_at) values
  (tests.inv_ok(),      tests.ws_a(), 'Carol@Example.com', 'admin',  tests.alice(), 'tok-ok-' || gen_random_uuid()::text,      now() + interval '1 day', null),
  (tests.inv_expired(), tests.ws_a(), 'carol@example.com', 'member', tests.alice(), 'tok-expired-' || gen_random_uuid()::text, now() - interval '1 minute', null),
  (tests.inv_used(),    tests.ws_a(), 'carol@example.com', 'member', tests.alice(), 'tok-used-' || gen_random_uuid()::text,    now() + interval '1 day', now() - interval '1 hour'),
  (tests.inv_dave(),    tests.ws_a(), 'dave@example.com',  'member', tests.alice(), 'tok-dave-' || gen_random_uuid()::text,    now() + interval '1 day', null),
  (tests.inv_erin(),    tests.ws_a(), 'erin@example.com',  'member', tests.alice(), 'tok-erin-' || gen_random_uuid()::text,    now() + interval '1 day', null),
  (tests.inv_alice(),   tests.ws_a(), 'alice@example.com', 'member', tests.alice(), 'tok-alice-' || gen_random_uuid()::text,   now() + interval '1 day', null);

-- ---------------------------------------------------------------------------
-- Function definition and grants
-- ---------------------------------------------------------------------------
select has_function('public', 'accept_invitation', array['text'], 'accept_invitation(text) exists');
select is_definer('public', 'accept_invitation', array['text'], 'accept_invitation is security definer');
select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'accept_invitation'),
  'accept_invitation has a fixed search_path');
select ok(not has_function_privilege('anon', 'public.accept_invitation(text)', 'execute'),
  'anon cannot execute accept_invitation');
select ok(not has_function_privilege('service_role', 'public.accept_invitation(text)', 'execute'),
  'service_role cannot execute accept_invitation (identity comes only from auth.uid())');
select ok(has_function_privilege('authenticated', 'public.accept_invitation(text)', 'execute'),
  'authenticated can execute accept_invitation');

select tests.login_as_anon();
select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_ok())),
  '42501', 'permission denied for function accept_invitation',
  'anon: calling accept_invitation is denied');
select tests.logout();

-- authenticated role but no sub claim (no user)
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_ok())),
  'PT401', 'authentication required',
  'authenticated without a user: PT401');
select tests.logout();

-- ---------------------------------------------------------------------------
-- carol: failure cases
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());

select throws_ok(
  $$select * from public.accept_invitation('definitely-not-a-token')$$,
  'PT404', 'invitation not found or already used',
  'carol: unknown token is PT404');
select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_dave())),
  'PT403', 'invitation was issued to a different email address',
  'carol: token for another email is PT403');
select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_expired())),
  'PT410', 'invitation has expired',
  'carol: expired invitation is PT410');
select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_used())),
  'PT404', 'invitation not found or already used',
  'carol: already accepted invitation is PT404');

select tests.logout();
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a() and user_id = tests.carol()),
  0, 'postgres: carol is still not a member after the failed attempts');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a() and action = 'invitation.accepted'),
  0, 'postgres: failed attempts wrote no invitation.accepted event');

-- ---------------------------------------------------------------------------
-- carol: happy path (email case differs: Carol@Example.com vs carol@example.com)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());

select results_eq(
  format('select workspace_id, workspace_name, workspace_slug, role::text from public.accept_invitation(%L)',
         tests.token_of(tests.inv_ok())),
  format($sql$values (%L::uuid, 'Workspace A', 'workspace-a', 'admin')$sql$, tests.ws_a()),
  'carol: accepting returns the workspace and the invited role');

select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a()), 2,
  'carol: can now read the members of workspace A');

select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_ok())),
  'PT404', 'invitation not found or already used',
  'carol: accepting the same token again is a clean PT404 (one-shot token)');

select tests.logout();

select is((select role::text from public.workspace_members where workspace_id = tests.ws_a() and user_id = tests.carol()),
  'admin', 'postgres: carol is a member of A with the invited role');
select ok((select accepted_at is not null from public.invitations where id = tests.inv_ok()),
  'postgres: accepted_at is stamped');
select ok((select accepted_at >= now() - interval '1 minute' from public.invitations where id = tests.inv_ok()),
  'postgres: accepted_at is now');

select results_eq(
  format($sql$select actor_id, entity_type, entity_id, metadata from public.audit_events
          where workspace_id = %L and action = 'invitation.accepted'$sql$, tests.ws_a()),
  format($sql$values (%L::uuid, 'invitation', %L::text,
          '{"role": "admin", "email": "Carol@Example.com", "already_member": false}'::jsonb)$sql$,
         tests.carol(), tests.inv_ok()),
  'postgres: one invitation.accepted event with carol as actor and email/role metadata');

select results_eq(
  format($sql$select actor_id, metadata from public.audit_events
          where workspace_id = %L and action = 'member.added' and entity_id = %L$sql$,
         tests.ws_a(), tests.carol()::text),
  format($sql$values (%L::uuid, '{"role": "admin"}'::jsonb)$sql$, tests.carol()),
  'postgres: member.added event for carol with carol as actor (trigger)');

select is(
  (select count(*)::int from public.audit_events a
   where a.metadata::text like '%' || tests.token_of(tests.inv_ok()) || '%'
      or a.metadata::text like '%tok-%'),
  0, 'postgres: no audit metadata contains an invitation token');

-- ---------------------------------------------------------------------------
-- erin: email not verified
-- ---------------------------------------------------------------------------
select tests.login_as(tests.erin());
select throws_ok(
  format('select * from public.accept_invitation(%L)', tests.token_of(tests.inv_erin())),
  'PT403', 'email address is not verified',
  'erin: unverified email is PT403');
select tests.logout();
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a() and user_id = tests.erin()),
  0, 'postgres: erin was not added');
select ok((select accepted_at is null from public.invitations where id = tests.inv_erin()),
  'postgres: erin''s invitation stays pending');

-- ---------------------------------------------------------------------------
-- alice: already a member (owner) accepting a member invitation
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select results_eq(
  format('select workspace_id, role::text from public.accept_invitation(%L)', tests.token_of(tests.inv_alice())),
  format($sql$values (%L::uuid, 'owner')$sql$, tests.ws_a()),
  'alice: already a member, accepting returns the existing role');
select tests.logout();

select is((select role::text from public.workspace_members where workspace_id = tests.ws_a() and user_id = tests.alice()),
  'owner', 'postgres: alice keeps her owner role');
select ok((select accepted_at is not null from public.invitations where id = tests.inv_alice()),
  'postgres: alice''s invitation is consumed');
select is((select count(*)::int from public.audit_events
           where workspace_id = tests.ws_a() and action = 'member.added' and entity_id = tests.alice()::text),
  1, 'postgres: no second member.added for alice (only the seed one)');
select is((select metadata ->> 'already_member' from public.audit_events
           where workspace_id = tests.ws_a() and action = 'invitation.accepted' and entity_id = tests.inv_alice()::text),
  'true', 'postgres: invitation.accepted for alice is flagged already_member');

select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a() and action = 'invitation.accepted'),
  2, 'postgres: exactly two invitation.accepted events in total');

select * from finish();
rollback;
