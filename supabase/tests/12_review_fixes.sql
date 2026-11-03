-- 12: migration 003 (Phase 2 review fixes).
--   * invitations: one pending invitation per (workspace, lower(email)); accepted
--     rows do not count; email must look like an address; authenticated may
--     insert only workspace_id/email/role/invited_by and cannot read the token
--   * workspace_members: no direct insert for owner or admin; the last-owner
--     guard still blocks demote/leave and takes an advisory lock
--   * account deletion: deleting a sole owner's auth.users row promotes the
--     earliest-joined admin (else the earliest member) or deletes the workspace
--     when nobody else is in it; audit rows have actor_id null
--   * profiles: email follows auth.users.email; full_name <= 100, avatar_url
--     https and <= 2048; handle_new_user() truncates/sanitises
--   * audit privacy: invitation events never carry the invitee's email
-- Fixtures created as postgres inside the transaction:
--   carol  admin of A, sole owner of C (frank admin -2h, dave admin -1h, erin member -3h),
--          sole owner of D (alone) and of E (erin member)
--   alice  owner of A (seed)
create extension if not exists pgtap with schema extensions;

begin;
select plan(65);
\ir helpers/tests_schema.sql.inc

-- Independent of pre-existing rows: assertions on A's invitations and their
-- audit rows are restricted to rows written in this transaction
-- (created_at >= now()); A's member count is a delta on the captured count.
create function tests.ws_c() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000cc'::uuid $$;
create function tests.ws_d() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000dd'::uuid $$;
create function tests.ws_e() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000ee'::uuid $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
select tests.remember_count('a_members', (select count(*) from public.workspace_members where workspace_id = tests.ws_a()));

select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Example');
select tests.create_user(tests.dave(),  'dave@example.com',  'Dave Example');
select tests.create_user(tests.erin(),  'erin@example.com',  'Erin Example');
select tests.create_user(tests.frank(), 'frank@example.com', 'Frank Example');

insert into public.workspace_members (workspace_id, user_id, role) values (tests.ws_a(), tests.carol(), 'admin');

insert into public.workspaces (id, name, slug, created_by) values
  (tests.ws_c(), 'Workspace C', 'workspace-c', tests.carol()),
  (tests.ws_d(), 'Workspace D', 'workspace-d', tests.carol()),
  (tests.ws_e(), 'Workspace E', 'workspace-e', tests.carol());

insert into public.workspace_members (workspace_id, user_id, role, created_at) values
  (tests.ws_c(), tests.erin(),  'member', now() - interval '3 hours'),
  (tests.ws_c(), tests.frank(), 'admin',  now() - interval '2 hours'),
  (tests.ws_c(), tests.dave(),  'admin',  now() - interval '1 hour'),
  (tests.ws_e(), tests.erin(),  'member', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_index('public', 'invitations', 'invitations_pending_unique', 'invitations_pending_unique exists');
select index_is_unique('public', 'invitations', 'invitations_pending_unique', 'invitations_pending_unique is unique');
select ok(
  (select indpred is not null from pg_index where indexrelid = 'public.invitations_pending_unique'::regclass),
  'invitations_pending_unique is partial (pending rows only)');
select col_has_check('public', 'invitations', 'email', 'invitations.email has a check constraint');
select ok(
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and cmd = 'INSERT'),
  'workspace_members has no insert policy any more');
select has_trigger('auth', 'users', 'on_auth_user_deleted', 'auth.users has the on_auth_user_deleted trigger');
select has_trigger('auth', 'users', 'on_auth_user_email_changed', 'auth.users has the on_auth_user_email_changed trigger');
select is_definer('public', 'handle_user_deleted', '{}'::text[], 'handle_user_deleted is security definer');
select is_definer('public', 'handle_user_email_changed', '{}'::text[], 'handle_user_email_changed is security definer');

-- ---------------------------------------------------------------------------
-- alice (owner of A): invitations hardening
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is(tests.rows_affected(format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'Dup@Example.com', 'member', %L)$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'owner: first pending invitation for an address is created');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'dup@example.com', 'admin', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '23505', null,
  'owner: second pending invitation for the same address (different case) is 23505');

select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'not-an-email', 'member', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '23514', null,
  'owner: email without @ fails the format check');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'no dot@example', 'member', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '23514', null,
  'owner: email with whitespace and no domain dot fails the format check');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'two@@example.com', 'member', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '23514', null,
  'owner: email with two @ fails the format check');

-- Column-level insert grant: only workspace_id, email, role, invited_by.
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by, token) values (%L, 'tok@example.com', 'member', %L, 'chosen-token')$sql$,
         tests.ws_a(), tests.alice()),
  '42501', 'permission denied for table invitations',
  'owner: cannot choose the token');
select throws_ok(
  format($sql$insert into public.invitations (workspace_id, email, role, invited_by, expires_at) values (%L, 'exp@example.com', 'member', %L, now() + interval '1 year')$sql$,
         tests.ws_a(), tests.alice()),
  '42501', 'permission denied for table invitations',
  'owner: cannot choose expires_at');
select throws_ok(
  format($sql$insert into public.invitations (id, workspace_id, email, role, invited_by) values (gen_random_uuid(), %L, 'id@example.com', 'member', %L)$sql$,
         tests.ws_a(), tests.alice()),
  '42501', 'permission denied for table invitations',
  'owner: cannot choose the id');

-- Column-level select grant: the token is hidden.
select throws_ok(
  'select token from public.invitations',
  '42501', 'permission denied for table invitations',
  'owner: select token is denied');
select throws_ok(
  'select * from public.invitations',
  '42501', 'permission denied for table invitations',
  'owner: select * is denied (it includes token)');
select is(
  (select count(*)::int from (
     select id, workspace_id, email, role, invited_by, expires_at, accepted_at, created_at
     from public.invitations where workspace_id = tests.ws_a() and created_at >= now()) s),
  1, 'owner: selecting the explicit allowed columns works');

-- No email in invitation audit metadata.
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.ws_a() and entity_type = 'invitation' and metadata ? 'email'),
  0, 'owner: invitation.created metadata has no email key');
select results_eq(
  format($sql$select metadata from public.audit_events
             where workspace_id = %L and action = 'invitation.created' and created_at >= now()$sql$, tests.ws_a()),
  format($sql$select jsonb_build_object('role', 'member', 'invitation_id', i.id) from public.invitations i
             where i.workspace_id = %L and i.created_at >= now()$sql$, tests.ws_a()),
  'owner: invitation.created metadata is exactly invitation_id and role');

select is(tests.rows_affected(format($sql$delete from public.invitations where workspace_id = %L and email = 'Dup@Example.com'$sql$, tests.ws_a())),
  1, 'owner: revokes the invitation');
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.ws_a() and action = 'invitation.revoked' and metadata ? 'email'),
  0, 'owner: invitation.revoked metadata has no email key');
select is(
  (select metadata - 'invitation_id' from public.audit_events
   where workspace_id = tests.ws_a() and action = 'invitation.revoked' and created_at >= now()),
  '{"role": "member", "accepted": false}'::jsonb,
  'owner: invitation.revoked metadata keeps role and accepted');

-- Partial index: an accepted row does not block a new pending one.
select is(tests.rows_affected(format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'again@example.com', 'member', %L)$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'owner: invitation for again@example.com created');
select tests.logout();
update public.invitations set accepted_at = now() where workspace_id = tests.ws_a() and email = 'again@example.com';
select tests.login_as(tests.alice());
select is(tests.rows_affected(format($sql$insert into public.invitations (workspace_id, email, role, invited_by) values (%L, 'again@example.com', 'member', %L)$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'owner: a new pending invitation is allowed once the previous one is accepted');

-- ---------------------------------------------------------------------------
-- workspace_members: no direct insert for owner or admin
-- ---------------------------------------------------------------------------
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_a(), tests.dave()),
  '42501', 'permission denied for table workspace_members',
  'owner: direct insert into workspace_members is denied');
select tests.logout();
select tests.login_as(tests.carol());
select throws_ok(
  format($sql$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'member')$sql$,
         tests.ws_a(), tests.dave()),
  '42501', 'permission denied for table workspace_members',
  'admin: direct insert into workspace_members is denied');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Last-owner guard still holds (alice is the sole owner of A)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select throws_ok(
  format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.alice()),
  'P0001', null,
  'sole owner: demoting herself still fails');
select throws_ok(
  format($sql$delete from public.workspace_members where workspace_id = %L and user_id = %L$sql$,
         tests.ws_a(), tests.alice()),
  'P0001', null,
  'sole owner: leaving still fails');
-- With carol promoted, demoting alice goes through and the guard holds its lock.
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.carol())),
  1, 'sole owner: promotes carol to owner');
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'admin' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'with two owners: demoting alice succeeds');
select ok(
  exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 1 and granted),
  'the guard holds a transaction-level advisory lock after an owner change');
select tests.logout();
select tests.login_as(tests.carol());
select is(tests.rows_affected(format($sql$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$sql$,
                                     tests.ws_a(), tests.alice())),
  1, 'carol (owner) re-promotes alice');
select tests.logout();
update public.workspace_members set role = 'admin' where workspace_id = tests.ws_a() and user_id = tests.carol();
select is(tests.role_in(tests.ws_a(), tests.carol()), 'admin', 'postgres: carol is back to admin of A, alice sole owner');

-- ---------------------------------------------------------------------------
-- Account deletion: carol's auth.users row is deleted (as postgres, like GoTrue)
-- ---------------------------------------------------------------------------
select is(tests.role_in(tests.ws_c(), tests.carol()), 'owner', 'before: carol is the sole owner of C');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_d()), 2,
  'before: workspace D has its two creation audit rows');

delete from auth.users where id = tests.carol();

select is((select count(*)::int from auth.users where id = tests.carol()), 0, 'carol''s auth.users row is gone');
select is((select count(*)::int from public.profiles where id = tests.carol()), 0, 'carol''s profile cascaded');
select is((select count(*)::int from public.workspace_members where user_id = tests.carol()), 0,
  'carol has no membership left');

-- C: frank (earliest-joined admin) is promoted; erin (earlier, but member) and dave (later admin) are not.
select is(tests.role_in(tests.ws_c(), tests.frank()), 'owner', 'C: the earliest-joined admin (frank) became owner');
select is(tests.role_in(tests.ws_c(), tests.dave()),  'admin', 'C: the later admin (dave) stays admin');
select is(tests.role_in(tests.ws_c(), tests.erin()),  'member', 'C: the earliest member (erin) stays member');
select results_eq(
  format($sql$select actor_id, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'member.role_changed'$sql$, tests.ws_c()),
  format($sql$values (null::uuid, %L::text, '{"to": "owner", "from": "admin"}'::jsonb)$sql$, tests.frank()),
  'C: one member.role_changed for frank with actor_id null');
select results_eq(
  format($sql$select actor_id, entity_id, metadata from public.audit_events
             where workspace_id = %L and action = 'member.removed'$sql$, tests.ws_c()),
  format($sql$values (null::uuid, %L::text, '{"role": "owner"}'::jsonb)$sql$, tests.carol()),
  'C: member.removed for carol with actor_id null');

-- E: no admin, so the earliest member (erin) is promoted.
select is(tests.role_in(tests.ws_e(), tests.erin()), 'owner', 'E: the only member (erin) became owner');
select is((select count(*)::int from public.audit_events
           where workspace_id = tests.ws_e() and action = 'member.role_changed' and actor_id is null
             and entity_id = tests.erin()::text and metadata = '{"to": "owner", "from": "member"}'::jsonb),
  1, 'E: member.role_changed for erin with actor_id null');

-- D: carol was alone, the workspace is deleted with everything in it.
select is((select count(*)::int from public.workspaces where id = tests.ws_d()), 0, 'D: workspace deleted');
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_d()), 0, 'D: memberships cascaded');
select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_d()), 0, 'D: audit rows cascaded');

-- A: alice remains owner; only carol's admin membership is removed.
select is(tests.role_in(tests.ws_a(), tests.alice()), 'owner', 'A: alice is still owner');
select is((select count(*)::int from public.workspace_members where workspace_id = tests.ws_a()), tests.recall_count('a_members'),
  'A: the member count is back to what it was before carol joined');
select is((select count(*)::int from public.audit_events
           where workspace_id = tests.ws_a() and action = 'member.removed' and entity_id = tests.carol()::text and actor_id is null),
  1, 'A: member.removed for carol with actor_id null');
select is((select count(*)::int from public.workspaces where id in (tests.ws_a(), tests.ws_c(), tests.ws_e())), 3,
  'A, C and E still exist');

-- ---------------------------------------------------------------------------
-- profiles: email sync and signup sanitising
-- ---------------------------------------------------------------------------
update auth.users set email = 'alice.new@example.com' where id = tests.alice();
select is((select email from public.profiles where id = tests.alice()), 'alice.new@example.com',
  'profiles.email follows auth.users.email');
update auth.users set updated_at = now() where id = tests.alice();
select is((select email from public.profiles where id = tests.alice()), 'alice.new@example.com',
  'an auth.users update that does not touch email leaves the profile alone');

select tests.create_user(tests.grace(), 'grace@example.com', repeat('g', 150), p_avatar => 'http://insecure.example.com/a.png');
select is((select char_length(full_name) from public.profiles where id = tests.grace()), 100,
  'handle_new_user truncates full_name to 100 chars');
select is((select avatar_url from public.profiles where id = tests.grace()), null,
  'handle_new_user drops a non-https avatar_url');

-- ---------------------------------------------------------------------------
-- profiles bounds (as alice, through the column grant)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
select throws_ok(
  format($sql$update public.profiles set full_name = repeat('x', 101) where id = %L$sql$, tests.alice()),
  '23514', null,
  'profiles: full_name longer than 100 chars is rejected');
select throws_ok(
  format($sql$update public.profiles set avatar_url = 'http://example.com/a.png' where id = %L$sql$, tests.alice()),
  '23514', null,
  'profiles: non-https avatar_url is rejected');
select throws_ok(
  format($sql$update public.profiles set avatar_url = 'https://example.com/' || repeat('a', 2048) where id = %L$sql$, tests.alice()),
  '23514', null,
  'profiles: avatar_url longer than 2048 chars is rejected');
select is(tests.rows_affected(format($sql$update public.profiles set full_name = repeat('x', 100), avatar_url = 'https://example.com/a.png' where id = %L$sql$, tests.alice())),
  1, 'profiles: 100-char full_name and https avatar_url are accepted');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Audit privacy across everything written in this file
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.audit_events where entity_type = 'invitation' and metadata ? 'email'),
  0, 'no invitation audit event carries an email');
select is(
  (select count(*)::int from public.audit_events where entity_type = 'invitation' and not (metadata ? 'invitation_id')),
  0, 'every invitation audit event carries invitation_id');

select * from finish();
rollback;
