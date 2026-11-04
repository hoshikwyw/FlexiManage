-- 22: plans, subscriptions, entitlements and plan limits (migration 007).
--   * structure: tables, RLS, grants, policies, function privileges, triggers
--   * plans catalogue (Free / Pro / Business, docs/PLANNING.md section 8),
--     readable by authenticated only, no client writes
--   * subscriptions: one per workspace (backfill + trigger), members read
--     their own only, no client insert/update/delete (rule 8)
--   * contract C6: PT402 plan_limit_exceeded with DETAIL
--     {"resource","limit","current","plan"} for members (memberships +
--     pending invitations), modules, records, storage_bytes and workspaces;
--     deletes, revokes, expiry, removal and cascades free capacity
--   * invitation / acceptance rule: acceptance consumes the reserved seat
--     (delta 0) but is refused while the workspace is over its member limit
--     (downgrade between invitation and acceptance)
--   * downgrades keep data: over-limit workspaces refuse only inserts
--   * callers the insert policy refuses get the RLS error, never PT402
--   * postgres sessions bypass the check; service_role does not
--   * change_workspace_plan(): audit subscription.plan_changed { from, to }
--
-- Every fixture is created inside the transaction (workspace W1 owned by
-- carol, on Free); the seed workspaces are only read.
create extension if not exists pgtap with schema extensions;

begin;
select plan(155);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Local helpers and ids
-- ---------------------------------------------------------------------------
create function tests.w1() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000022a1'::uuid $$;
create function tests.w2() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000022a2'::uuid $$;
create function tests.w3() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000022a3'::uuid $$;
create function tests.w4() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000022a4'::uuid $$;
create function tests.m(p_n integer) returns uuid language sql immutable
  as $$ select ('00000000-0000-0000-0000-0000000022b' || p_n::text)::uuid $$;
create function tests.r(p_n integer) returns uuid language sql immutable
  as $$ select ('00000000-0000-0000-0000-0000000022e' || p_n::text)::uuid $$;

-- Run a statement as the current role. Success: {"sqlstate": "00000"} (the
-- effects stay). Failure: {"sqlstate", "message", "detail"} with DETAIL parsed
-- as JSON when it is a JSON object (the effects are rolled back).
create function tests.try_sql(p_sql text) returns jsonb
language plpgsql as $$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  execute p_sql;
  return '{"sqlstate": "00000"}'::jsonb;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object(
    'sqlstate', v_state,
    'message', v_msg,
    'detail', case when v_detail ~ '^\{' then v_detail::jsonb else to_jsonb(nullif(v_detail, '')) end);
end;
$$;

-- The PT402 answer of contract C6.
create function tests.limit_error(p_resource text, p_limit bigint, p_current bigint, p_plan text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'sqlstate', 'PT402',
    'message', 'plan_limit_exceeded',
    'detail', jsonb_build_object('resource', p_resource, 'limit', p_limit,
                                 'current', p_current, 'plan', p_plan))
$$;

-- Act as the service role the way PostgREST does (no sub, RLS bypassed).
create function tests.as_service_role() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end;
$$;

-- Token of the pending invitation for an address (readable while impersonating).
create function tests.pending_token(p_ws uuid, p_email text) returns text
language sql security definer set search_path = '' as $$
  select i.token from public.invitations i
  where i.workspace_id = p_ws and lower(i.email) = lower(p_email) and i.accepted_at is null
$$;

-- Enforced usage of W1 per resource, readable while impersonating.
create function tests.usage(p_ws uuid, p_resource text) returns bigint
language sql security definer set search_path = '' as $$
  select public.entitlement_usage(p_ws, p_resource)
$$;

create function tests.invite_sql(p_ws uuid, p_email text, p_by uuid) returns text
language sql immutable as $$
  select format('insert into public.invitations (workspace_id, email, role, invited_by) values (%L, %L, ''member'', %L)',
                p_ws, p_email, p_by)
$$;

create function tests.accept_sql(p_ws uuid, p_email text) returns text
language sql stable as $$
  select format('select * from public.accept_invitation(%L)', tests.pending_token(p_ws, p_email))
$$;

create function tests.module_sql(p_id uuid, p_ws uuid, p_slug text) returns text
language sql immutable as $$
  select format('insert into public.modules (id, workspace_id, name, slug) values (%L, %L, %L, %L)',
                p_id, p_ws, initcap(p_slug), p_slug)
$$;

create function tests.workspace_sql(p_id uuid, p_slug text, p_by uuid) returns text
language sql immutable as $$
  select format('insert into public.workspaces (id, name, slug, created_by) values (%L, %L, %L, %L)',
                p_id, initcap(p_slug), p_slug, p_by)
$$;

-- Users (as postgres)
select tests.create_user(tests.carol(), 'carol@example.com', 'Carol Owner');
select tests.create_user(tests.dave(),  'dave@example.com',  'Dave Invitee');
select tests.create_user(tests.erin(),  'erin@example.com',  'Erin Invitee');
select tests.create_user(tests.frank(), 'frank@example.com', 'Frank Invitee');
select tests.create_user(tests.grace(), 'grace@example.com', 'Grace Invitee');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_table('public', 'plans', 'table public.plans exists');
select has_table('public', 'subscriptions', 'table public.subscriptions exists');
select ok((select relrowsecurity from pg_class where oid = 'public.plans'::regclass), 'rls is enabled on public.plans');
select ok((select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass), 'rls is enabled on public.subscriptions');
select enum_has_labels('public', 'subscription_status', array['active', 'past_due', 'canceled'],
  'subscription_status has the three documented labels');

select table_privs_are('public', t, 'anon', '{}'::text[], format('anon has no privilege on public.%s', t))
from unnest(array['plans', 'subscriptions']) t;
select table_privs_are('public', t, 'authenticated', array['SELECT'], format('authenticated may only select public.%s', t))
from unnest(array['plans', 'subscriptions']) t;

select policies_are('public', 'plans', array['plans_select_authenticated'],
  'plans has exactly the documented policies (select only)');
select policies_are('public', 'subscriptions', array['subscriptions_select_member'],
  'subscriptions has exactly the documented policies (select only)');

select has_trigger('public', t, tg, format('trigger %s on %s', tg, t))
from (values
  ('workspaces', 'workspaces_check_entitlement'),
  ('workspaces', 'workspaces_create_subscription'),
  ('workspace_members', 'workspace_members_check_entitlement'),
  ('invitations', 'invitations_check_entitlement'),
  ('modules', 'modules_check_entitlement'),
  ('records', 'records_check_entitlement'),
  ('attachments', 'attachments_check_entitlement'),
  ('subscriptions', 'subscriptions_audit')
) v(t, tg);

select is_definer('public', 'check_entitlement', array['uuid', 'text', 'bigint'], 'check_entitlement is security definer');
select volatility_is('public', 'check_entitlement', array['uuid', 'text', 'bigint'], 'volatile',
  'check_entitlement is volatile (fresh snapshot after the lock)');

-- Internal and trigger functions: no API role may execute them.
select function_privs_are('public', f, a, r, '{}'::text[], format('%s cannot execute %s', r, f))
from (values
  ('check_entitlement', array['uuid', 'text', 'bigint']),
  ('check_workspace_entitlement', array['uuid']),
  ('workspace_effective_plan', array['uuid']),
  ('entitlement_usage', array['uuid', 'text']),
  ('owned_workspace_allowance', array['uuid']),
  ('entitlement_check_bypassed', '{}'::text[]),
  ('enforce_entitlement', '{}'::text[]),
  ('enforce_workspace_entitlement', '{}'::text[]),
  ('handle_workspace_subscription', '{}'::text[]),
  ('audit_subscription_change', '{}'::text[])
) v(f, a), unnest(array['anon', 'authenticated', 'service_role']) r;

select function_privs_are('public', 'workspace_entitlements', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can execute workspace_entitlements');
select function_privs_are('public', 'workspace_entitlements', array['uuid'], 'anon', '{}'::text[],
  'anon cannot execute workspace_entitlements');
select function_privs_are('public', 'change_workspace_plan', array['uuid', 'text', 'uuid'], 'service_role', array['EXECUTE'],
  'service_role can execute change_workspace_plan');
select function_privs_are('public', 'change_workspace_plan', array['uuid', 'text', 'uuid'], r, '{}'::text[],
  format('%s cannot execute change_workspace_plan', r))
from unnest(array['anon', 'authenticated']) r;

-- ---------------------------------------------------------------------------
-- Plans catalogue
-- ---------------------------------------------------------------------------
select results_eq(
  $$select key, name, price_cents, currency, active, max_workspaces, max_members, max_modules,
           max_records, max_storage_bytes
    from public.plans where key in ('free', 'pro', 'business') order by position$$,
  $$values ('free', 'Free', 0, 'USD', true, 1, 2, 1, 200, 52428800::bigint),
           ('pro', 'Pro', 900, 'USD', true, 1, 5, 5, 5000, 1073741824::bigint),
           ('business', 'Business', 2900, 'USD', true, 3, 20, 20, 50000, 10737418240::bigint)$$,
  'plans holds Free, Pro and Business with the section 8 limits');

select tests.login_as(tests.alice());
select is((select count(*)::int from public.plans where key in ('free', 'pro', 'business')), 3,
  'alice (authenticated) reads the plan catalogue');
select throws_ok($$insert into public.plans (key, name, price_cents, max_workspaces, max_members, max_modules, max_records, max_storage_bytes)
                   values ('gold', 'Gold', 1, 1, 1, 1, 1, 1)$$,
  '42501', null, 'alice cannot insert a plan');
select throws_ok($$update public.plans set max_records = 1000000 where key = 'free'$$,
  '42501', null, 'alice cannot update a plan');
select throws_ok($$delete from public.plans where key = 'free'$$,
  '42501', null, 'alice cannot delete a plan');
select tests.logout();

select tests.login_as_anon();
select throws_ok($$select count(*) from public.plans$$, '42501', null, 'anon cannot read plans');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Subscriptions: backfill, creation, isolation
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.workspaces w
   where (select count(*) from public.subscriptions s where s.workspace_id = w.id) <> 1),
  0, 'every workspace has exactly one subscription');

-- carol creates W1 through RLS: Free, active, manual.
select tests.login_as(tests.carol());
select is(tests.try_sql(tests.workspace_sql(tests.w1(), 'limits-one', tests.carol())), '{"sqlstate": "00000"}'::jsonb,
  'carol creates her first workspace W1');
select results_eq(
  format($$select plan_key, status::text, provider, created_by from public.subscriptions where workspace_id = %L$$, tests.w1()),
  format($$values ('free'::text, 'active'::text, 'manual'::text, %L::uuid)$$, tests.carol()),
  'W1 got a Free / active / manual subscription created by carol');
select is_empty(
  $$select workspace_id from public.subscriptions except select public.current_user_workspace_ids()$$,
  'carol sees no subscription outside her workspaces');
select tests.logout();

select tests.login_as(tests.bob());
select is_empty(
  $$select workspace_id from public.subscriptions except select public.current_user_workspace_ids()$$,
  'bob sees no subscription outside his workspaces');
select is((select count(*)::int from public.subscriptions where workspace_id = tests.ws_b()), 1,
  'bob sees the subscription of B');
select is((select count(*)::int from public.subscriptions where workspace_id in (tests.ws_a(), tests.w1())), 0,
  'bob sees neither A''s nor W1''s subscription');
select throws_ok(format($$update public.subscriptions set plan_key = 'business' where workspace_id = %L$$, tests.ws_a()),
  '42501', null, 'bob cannot update A''s subscription');
select throws_ok(format($$update public.subscriptions set plan_key = 'business' where workspace_id = %L$$, tests.ws_b()),
  '42501', null, 'bob cannot update his own subscription');
select throws_ok(format($$insert into public.subscriptions (workspace_id, plan_key) values (%L, 'business')$$, tests.w1()),
  '42501', null, 'bob cannot insert a subscription for W1');
select throws_ok(format($$delete from public.subscriptions where workspace_id = %L$$, tests.ws_a()),
  '42501', null, 'bob cannot delete A''s subscription');
select throws_ok(format($$delete from public.subscriptions where workspace_id = %L$$, tests.ws_b()),
  '42501', null, 'bob cannot delete his own subscription');
select throws_ok(format($$select * from public.workspace_entitlements(%L)$$, tests.w1()),
  '42501', 'not a member of this workspace', 'bob cannot read W1''s entitlements');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Members: memberships + pending invitations (W1, Free: 2)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());
select is(tests.try_sql(tests.invite_sql(tests.w1(), 'dave@example.com', tests.carol())), '{"sqlstate": "00000"}'::jsonb,
  'members: carol invites dave (1 member + 1 pending = 2 of 2)');
select is(tests.try_sql(tests.invite_sql(tests.w1(), 'erin@example.com', tests.carol())),
  tests.limit_error('members', 2, 2, 'free'),
  'members: inviting erin at 2 of 2 fails with PT402 and the C6 detail');
select results_eq(
  format($$select plan, limit_value, current_value, over_limit from public.workspace_entitlements(%L) where resource = 'members'$$, tests.w1()),
  $$values ('free'::text, 2::bigint, 2::bigint, false)$$,
  'workspace_entitlements shows members 2 of 2 on Free, not over the limit');
select is(tests.rows_affected(format($$delete from public.invitations where workspace_id = %L and email = 'dave@example.com'$$, tests.w1())), 1,
  'members: carol revokes dave''s invitation');
select is(tests.try_sql(tests.invite_sql(tests.w1(), 'erin@example.com', tests.carol())), '{"sqlstate": "00000"}'::jsonb,
  'members: a revoked invitation frees its seat (erin invited)');
select tests.logout();

-- Expiry frees the seat too.
update public.invitations set expires_at = now() - interval '1 minute'
 where workspace_id = tests.w1() and email = 'erin@example.com';
select tests.login_as(tests.carol());
select is(tests.try_sql(tests.invite_sql(tests.w1(), 'frank@example.com', tests.carol())), '{"sqlstate": "00000"}'::jsonb,
  'members: an expired invitation does not count (frank invited)');
select tests.logout();

select tests.login_as(tests.frank());
select is(tests.try_sql(tests.accept_sql(tests.w1(), 'frank@example.com')), '{"sqlstate": "00000"}'::jsonb,
  'members: frank accepts at 2 of 2 (the invitation''s reserved seat)');
select tests.logout();
select is(tests.role_in(tests.w1(), tests.frank()), 'member', 'frank is a member of W1');

select tests.login_as(tests.carol());
select is(tests.try_sql(tests.invite_sql(tests.w1(), 'grace@example.com', tests.carol())),
  tests.limit_error('members', 2, 2, 'free'),
  'members: two memberships fill the Free plan (grace refused)');
select is(tests.rows_affected(format($$delete from public.workspace_members where workspace_id = %L and user_id = %L$$, tests.w1(), tests.frank())), 1,
  'members: carol removes frank');
select is(tests.try_sql(tests.invite_sql(tests.w1(), 'grace@example.com', tests.carol())), '{"sqlstate": "00000"}'::jsonb,
  'members: a removed member frees the seat (grace invited)');
select tests.logout();
select tests.login_as(tests.grace());
select is(tests.try_sql(tests.accept_sql(tests.w1(), 'grace@example.com')), '{"sqlstate": "00000"}'::jsonb,
  'members: grace accepts');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Downgrade between invitation and acceptance
-- ---------------------------------------------------------------------------
select tests.as_service_role();
select results_eq(
  format($$select from_plan, to_plan, changed, over_limit from public.change_workspace_plan(%L, 'pro')$$, tests.w1()),
  $$values ('free'::text, 'pro'::text, true, '{}'::text[])$$,
  'change_workspace_plan: W1 free -> pro');
select tests.logout();

select tests.login_as(tests.carol());
select is(
  tests.try_sql(tests.invite_sql(tests.w1(), 'dave@example.com', tests.carol()) || '; '
                || tests.invite_sql(tests.w1(), 'frank@example.com', tests.carol())),
  '{"sqlstate": "00000"}'::jsonb,
  'on Pro carol invites dave and frank (2 members + 2 pending = 4 of 5)');
select tests.logout();

select tests.as_service_role();
select results_eq(
  format($$select from_plan, to_plan, changed, over_limit from public.change_workspace_plan(%L, 'free')$$, tests.w1()),
  $$values ('pro'::text, 'free'::text, true, array['members']::text[])$$,
  'change_workspace_plan: downgrade to Free is allowed and reports members over the limit');
select tests.logout();

select is(
  (select count(*)::int from public.workspace_members where workspace_id = tests.w1())
  + (select count(*)::int from public.invitations where workspace_id = tests.w1() and accepted_at is null and expires_at > now()),
  4, 'downgrade kept both memberships and both pending invitations');

select tests.login_as(tests.dave());
select is(tests.try_sql(tests.accept_sql(tests.w1(), 'dave@example.com')),
  tests.limit_error('members', 2, 4, 'free'),
  'accepting after a downgrade below the reserved seats fails with PT402');
select tests.logout();
select is(tests.role_in(tests.w1(), tests.dave()), null, 'dave did not join');

select tests.login_as(tests.carol());
select is(tests.rows_affected(format($$delete from public.invitations where workspace_id = %L and email = 'frank@example.com' and accepted_at is null$$, tests.w1())), 1,
  'carol revokes frank''s pending invitation');
select tests.logout();
select tests.login_as(tests.dave());
select is(tests.try_sql(tests.accept_sql(tests.w1(), 'dave@example.com')),
  tests.limit_error('members', 2, 3, 'free'),
  'still over the limit (2 members + 1 pending): acceptance refused');
select tests.logout();
select tests.login_as(tests.carol());
select is(tests.rows_affected(format($$delete from public.workspace_members where workspace_id = %L and user_id = %L$$, tests.w1(), tests.grace())), 1,
  'carol removes grace');
select tests.logout();
select tests.login_as(tests.dave());
select is(tests.try_sql(tests.accept_sql(tests.w1(), 'dave@example.com')), '{"sqlstate": "00000"}'::jsonb,
  'back at the limit (1 member + 1 pending): dave accepts');
select tests.logout();

-- A plain member at the member limit gets the RLS answer, not PT402.
select tests.login_as(tests.dave());
select throws_ok(tests.invite_sql(tests.w1(), 'erin2@example.com', tests.dave()), '42501', null,
  'dave (member) inviting at the limit gets 42501 from RLS, not PT402');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Modules (W1, Free: 1)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());
select is(tests.try_sql(tests.module_sql(tests.m(1), tests.w1(), 'limits-m1')), '{"sqlstate": "00000"}'::jsonb,
  'modules: carol creates the first module');
select is(tests.try_sql(tests.module_sql(tests.m(2), tests.w1(), 'limits-m2')),
  tests.limit_error('modules', 1, 1, 'free'),
  'modules: a second module on Free fails with PT402');
select tests.logout();

select tests.login_as(tests.dave());
select throws_ok(tests.module_sql(tests.m(2), tests.w1(), 'limits-m2'), '42501', null,
  'modules: dave (member) gets 42501 from RLS, not PT402');
select tests.logout();
select tests.login_as(tests.bob());
select throws_ok(tests.module_sql(tests.m(2), tests.w1(), 'limits-m2'), '42501', null,
  'modules: bob (not a member) gets 42501 from RLS, never W1''s usage');
select tests.logout();

-- postgres (seed, operators) is not checked; service_role is.
select lives_ok(tests.module_sql(tests.m(2), tests.w1(), 'limits-m2'),
  'modules: postgres inserts past the limit (seed/operator bypass)');
select tests.as_service_role();
select is(tests.try_sql(tests.module_sql(tests.m(3), tests.w1(), 'limits-m3')),
  tests.limit_error('modules', 1, 2, 'free'),
  'modules: service_role is checked (PT402, current 2)');
select tests.logout();

select tests.login_as(tests.carol());
select is(tests.rows_affected(format($$delete from public.modules where id = %L$$, tests.m(2))), 1,
  'modules: carol deletes the extra module');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Records (W1, Free: 200)
-- ---------------------------------------------------------------------------
insert into public.records (workspace_id, module_id, title, created_by)
select tests.w1(), tests.m(1), 'Filler ' || g, tests.carol() from generate_series(1, 199) g;

select tests.login_as(tests.carol());
select is(tests.try_sql(format($$insert into public.records (workspace_id, module_id, title) values (%L, %L, 'Record 200')$$, tests.w1(), tests.m(1))),
  '{"sqlstate": "00000"}'::jsonb, 'records: the 200th record is accepted');
select tests.logout();
select tests.login_as(tests.dave());
select is(tests.try_sql(format($$insert into public.records (workspace_id, module_id, title) values (%L, %L, 'Record 201')$$, tests.w1(), tests.m(1))),
  tests.limit_error('records', 200, 200, 'free'),
  'records: the 201st record fails with PT402');
select is(tests.rows_affected(format($$update public.records set title = 'Filler 1 (edited)' where workspace_id = %L and title = 'Filler 1'$$, tests.w1())), 1,
  'records: edits still work at the limit');
select tests.logout();
select tests.login_as(tests.bob());
select throws_ok(format($$insert into public.records (workspace_id, module_id, title) values (%L, %L, 'Hijack')$$, tests.w1(), tests.m(1)),
  '42501', null, 'records: bob (not a member) gets 42501 from RLS, not PT402');
select tests.logout();

select tests.login_as(tests.carol());
select is(tests.rows_affected(format($$delete from public.records where workspace_id = %L and title = 'Filler 2'$$, tests.w1())), 1,
  'records: carol deletes one record');
select tests.logout();
select tests.login_as(tests.dave());
select is(tests.try_sql(format($$insert into public.records (workspace_id, module_id, title) values (%L, %L, 'Record 201')$$, tests.w1(), tests.m(1))),
  '{"sqlstate": "00000"}'::jsonb, 'records: a deleted record frees its slot');
select tests.logout();

select tests.login_as(tests.carol());
select is(tests.rows_affected(format($$delete from public.records where workspace_id = %L and title in ('Filler 3', 'Filler 4')$$, tests.w1())), 2,
  'records: carol deletes two more (198 of 200)');
select is(tests.try_sql(format($$insert into public.records (workspace_id, module_id, title) select %L, %L, 'Bulk ' || g from generate_series(1, 3) g$$, tests.w1(), tests.m(1))),
  tests.limit_error('records', 200, 200, 'free'),
  'records: a three-row insert crossing the limit fails on its third row');
select is(tests.usage(tests.w1(), 'records'), 198::bigint, 'records: the failed bulk insert left nothing behind');

-- Module delete cascades its records: both counters drop.
select is(tests.rows_affected(format($$delete from public.modules where id = %L$$, tests.m(1))), 1,
  'carol deletes the module with its 198 records');
select results_eq(
  format($$select resource, current_value from public.workspace_entitlements(%L) where resource in ('modules', 'records') order by resource$$, tests.w1()),
  $$values ('modules'::text, 0::bigint), ('records'::text, 0::bigint)$$,
  'module cascade freed the module and all its records');
select is(tests.try_sql(tests.module_sql(tests.m(3), tests.w1(), 'limits-m3')), '{"sqlstate": "00000"}'::jsonb,
  'modules: the freed slot takes a new module');
select tests.create_record(tests.r(1), tests.m(3), 'Files 1', p_created_by => tests.carol());
select tests.create_record(tests.r(2), tests.m(3), 'Files 2', p_created_by => tests.carol());
select tests.logout();

-- ---------------------------------------------------------------------------
-- Storage (W1, Free: 50 MB = 52428800 bytes, declared size_bytes)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());
select is(tests.try_sql(format(
  $$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes)
    select %L, %L, 'big-' || g || '.txt', 'text/plain', 10485760 from generate_series(1, 5) g$$,
  tests.w1(), tests.r(1))), '{"sqlstate": "00000"}'::jsonb,
  'storage: five 10 MB attachments fill 50 MB (in-flight rows count)');
select is(tests.try_sql(format(
  $$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes) values (%L, %L, 'tiny.txt', 'text/plain', 1)$$,
  tests.w1(), tests.r(2))),
  tests.limit_error('storage_bytes', 52428800, 52428800, 'free'),
  'storage: one more byte fails with PT402');
select tests.logout();

-- A stale pending row (upload abandoned more than an hour ago) does not count.
update public.attachments set created_at = now() - interval '2 hours'
 where workspace_id = tests.w1() and file_name = 'big-5.txt';
select tests.login_as(tests.carol());
select is(tests.try_sql(format(
  $$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes) values (%L, %L, 'tiny.txt', 'text/plain', 1)$$,
  tests.w1(), tests.r(2))), '{"sqlstate": "00000"}'::jsonb,
  'storage: a stale pending row frees its bytes');
select tests.logout();

update public.attachments set uploaded_at = now()
 where workspace_id = tests.w1() and created_at > now() - interval '1 hour';
select tests.login_as(tests.carol());
select is(tests.try_sql(format(
  $$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes) values (%L, %L, 'big-6.txt', 'text/plain', 10485760)$$,
  tests.w1(), tests.r(2))),
  tests.limit_error('storage_bytes', 52428800, 41943041, 'free'),
  'storage: the declared size is checked before the upload (PT402, current 41943041)');
select is(tests.rows_affected(format($$delete from public.attachments where workspace_id = %L and file_name = 'tiny.txt'$$, tests.w1())), 1,
  'storage: carol deletes the 1-byte attachment');
select is(tests.try_sql(format(
  $$insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes) values (%L, %L, 'big-6.txt', 'text/plain', 10485760)$$,
  tests.w1(), tests.r(2))), '{"sqlstate": "00000"}'::jsonb,
  'storage: a deleted attachment row frees its bytes (exactly 50 MB again)');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Workspaces: owned vs. the best plan among owned workspaces (Free if none)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.carol());
select is(tests.try_sql(tests.workspace_sql(tests.w2(), 'limits-two', tests.carol())),
  tests.limit_error('workspaces', 1, 1, 'free'),
  'workspaces: a Free owner cannot create a second workspace');
select tests.logout();

select tests.as_service_role();
select is((select changed from public.change_workspace_plan(tests.w1(), 'business')), true,
  'change_workspace_plan: W1 free -> business');
select tests.logout();

select tests.login_as(tests.carol());
select is(tests.try_sql(tests.workspace_sql(tests.w2(), 'limits-two', tests.carol())
                        || '; ' || tests.workspace_sql(tests.w3(), 'limits-three', tests.carol())),
  '{"sqlstate": "00000"}'::jsonb,
  'workspaces: owning a Business workspace allows three (W2, W3 created)');
select is(tests.try_sql(tests.workspace_sql(tests.w4(), 'limits-four', tests.carol())),
  tests.limit_error('workspaces', 3, 3, 'business'),
  'workspaces: the fourth fails with PT402 (plan business)');
select is((select plan_key from public.subscriptions where workspace_id = tests.w2()), 'free',
  'workspaces: new workspaces start on Free');
select tests.logout();

select tests.login_as(tests.alice());
select throws_ok(tests.workspace_sql(tests.w4(), 'limits-four', tests.carol()), '42501', null,
  'workspaces: alice creating one for carol gets 42501 from RLS, not carol''s count');
select tests.logout();

select lives_ok(tests.workspace_sql(tests.w4(), 'limits-four', tests.carol()),
  'workspaces: postgres is not checked');

-- canceled falls back to Free; past_due keeps the plan.
update public.subscriptions set status = 'past_due' where workspace_id = tests.w1();
select tests.login_as(tests.carol());
select is((select plan from public.workspace_entitlements(tests.w1()) where resource = 'members'), 'business',
  'past_due keeps the plan''s limits');
select tests.logout();
update public.subscriptions set status = 'canceled' where workspace_id = tests.w1();
select tests.login_as(tests.carol());
select results_eq(
  format($$select plan, limit_value from public.workspace_entitlements(%L) where resource in ('modules', 'workspaces') order by resource$$, tests.w1()),
  $$values ('free'::text, 1::bigint), ('free'::text, 1::bigint)$$,
  'canceled falls back to Free (modules and the owner''s workspace allowance)');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Over the limit after a downgrade: data kept, only inserts refused
-- ---------------------------------------------------------------------------
select tests.as_service_role();
select results_eq(
  format($$select from_plan, to_plan, changed from public.change_workspace_plan(%L, 'business')$$, tests.w1()),
  $$values ('business'::text, 'business'::text, true)$$,
  'change_workspace_plan reactivates a canceled subscription (status change only)');
select tests.logout();

select tests.login_as(tests.carol());
select is(tests.try_sql(tests.module_sql(tests.m(4), tests.w1(), 'limits-m4') || '; ' || tests.module_sql(tests.m(5), tests.w1(), 'limits-m5')),
  '{"sqlstate": "00000"}'::jsonb, 'on Business carol has three modules');
select tests.logout();

select tests.as_service_role();
select results_eq(
  format($$select from_plan, to_plan, changed, over_limit from public.change_workspace_plan(%L, 'free')$$, tests.w1()),
  $$values ('business'::text, 'free'::text, true, array['modules']::text[])$$,
  'downgrade to Free with three modules: allowed, modules reported over the limit');
select tests.logout();

select tests.login_as(tests.carol());
select is((select count(*)::int from public.modules where workspace_id = tests.w1()), 3,
  'over-limit workspace keeps all three modules');
select is(tests.rows_affected(format($$update public.modules set name = 'Renamed' where id = %L$$, tests.m(4))), 1,
  'over-limit workspace: modules can still be edited');
select is(tests.try_sql(tests.module_sql(tests.m(6), tests.w1(), 'limits-m6')),
  tests.limit_error('modules', 1, 3, 'free'),
  'over-limit workspace: a new module fails with PT402');
select is(tests.try_sql(format($$insert into public.records (workspace_id, module_id, title) values (%L, %L, 'Still fine')$$, tests.w1(), tests.m(4))),
  '{"sqlstate": "00000"}'::jsonb,
  'over-limit workspace: resources under their limit still accept inserts');
select ok((select over_limit from public.workspace_entitlements(tests.w1()) where resource = 'modules'),
  'workspace_entitlements marks modules over the limit');
select is(tests.rows_affected(format($$delete from public.modules where id = %L$$, tests.m(5))), 1,
  'over-limit workspace: modules can still be deleted');
select is(tests.try_sql(tests.module_sql(tests.m(6), tests.w1(), 'limits-m6')),
  tests.limit_error('modules', 1, 2, 'free'),
  'one delete is not enough: still over the limit (current 2)');
select tests.logout();

-- ---------------------------------------------------------------------------
-- change_workspace_plan and its audit trail
-- ---------------------------------------------------------------------------
select results_eq(
  format($$select metadata, actor_id from public.audit_events
           where workspace_id = %L and action = 'subscription.plan_changed'
           order by id desc limit 1$$, tests.w1()),
  $$values ('{"from": "business", "to": "free"}'::jsonb, null::uuid)$$,
  'subscription.plan_changed { from, to } with a null actor for the operator call');
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.w1() and action = 'subscription.plan_changed'),
  4, 'every plan change was audited (free->pro, pro->free, free->business, business->free)');
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.w1() and action = 'subscription.status_changed'),
  3, 'status changes are audited (past_due, canceled, active)');

select tests.as_service_role();
select is((select changed from public.change_workspace_plan(tests.w1(), 'pro', tests.carol())), true,
  'change_workspace_plan with p_actor_id');
select tests.logout();
select is(
  (select actor_id from public.audit_events
   where workspace_id = tests.w1() and action = 'subscription.plan_changed' order by id desc limit 1),
  tests.carol(), 'p_actor_id becomes the audit actor');

select tests.as_service_role();
select results_eq(
  format($$select from_plan, to_plan, changed from public.change_workspace_plan(%L, 'pro')$$, tests.w1()),
  $$values ('pro'::text, 'pro'::text, false)$$,
  'change_workspace_plan to the current plan is a no-op');
select throws_ok(format($$select * from public.change_workspace_plan(%L, 'gold')$$, tests.w1()),
  '22023', 'unknown_plan', 'change_workspace_plan: unknown plan is 22023 unknown_plan');
select throws_ok($$select * from public.change_workspace_plan('00000000-0000-0000-0000-0000000022ff', 'pro')$$,
  'PT404', 'workspace_not_found', 'change_workspace_plan: unknown workspace is PT404');
select tests.logout();
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = tests.w1() and action = 'subscription.plan_changed'),
  5, 'the no-op wrote no audit row');

select tests.login_as(tests.carol());
select throws_ok(format($$select * from public.change_workspace_plan(%L, 'business')$$, tests.w1()),
  '42501', null, 'carol (owner) cannot change her own plan');
select tests.logout();

-- A direct operator update (Studio, psql) is audited too.
update public.subscriptions set plan_key = 'business' where workspace_id = tests.w1();
select is(
  (select metadata from public.audit_events
   where workspace_id = tests.w1() and action = 'subscription.plan_changed' order by id desc limit 1),
  '{"from": "pro", "to": "business"}'::jsonb, 'a direct update as postgres is audited');

-- ---------------------------------------------------------------------------
-- workspace_entitlements shape
-- ---------------------------------------------------------------------------
select tests.login_as(tests.dave());
select results_eq(
  format($$select resource, plan from public.workspace_entitlements(%L)$$, tests.w1()),
  $$values ('members'::text, 'business'::text), ('modules', 'business'), ('records', 'business'),
           ('storage_bytes', 'business'), ('workspaces', 'free')$$,
  'workspace_entitlements: five rows in a fixed order; workspaces is about the caller');
select results_eq(
  format($$select limit_value, current_value, over_limit from public.workspace_entitlements(%L) where resource = 'workspaces'$$, tests.w1()),
  $$values (1::bigint, 0::bigint, false)$$,
  'dave owns no workspace: may own one (Free)');
select tests.logout();

select * from finish();
rollback;
