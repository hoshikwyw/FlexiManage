-- 05: cross-workspace isolation on public.audit_events.
-- Members read their own workspace's log and nothing else; authenticated can
-- never insert, update or delete (the log is written by triggers and Edge
-- Functions only). Covers the four section 7 matrix cells for `audit_events`.
create extension if not exists pgtap with schema extensions;

begin;
select plan(15);

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

select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_b()), 0,
  'alice: select of workspace B audit events returns 0 rows');
select results_eq(
  format('select action from public.audit_events where workspace_id = %L order by action', tests.ws_a()),
  array['member.added', 'workspace.created'],
  'alice: reads the two seed audit events of workspace A'
);
select is((select count(*)::int from public.audit_events where workspace_id <> tests.ws_a()), 0,
  'alice: sees no audit event outside workspace A');

select throws_ok(
  format($sql$insert into public.audit_events (workspace_id, actor_id, action, entity_type) values (%L, %L, 'x.y', 'x')$sql$,
         tests.ws_b(), tests.alice()),
  '42501',
  'permission denied for table audit_events',
  'alice: insert of an audit event with workspace B id is denied'
);
select throws_ok(
  format($sql$insert into public.audit_events (workspace_id, actor_id, action, entity_type) values (%L, %L, 'x.y', 'x')$sql$,
         tests.ws_a(), tests.alice()),
  '42501',
  'permission denied for table audit_events',
  'alice: authenticated cannot insert audit events even for her own workspace'
);

select throws_ok(
  format($sql$update public.audit_events set metadata = '{}' where workspace_id = %L$sql$, tests.ws_b()),
  '42501',
  'permission denied for table audit_events',
  'alice: update of workspace B audit events is denied'
);
select throws_ok(
  format($sql$update public.audit_events set metadata = '{}' where workspace_id = %L$sql$, tests.ws_a()),
  '42501',
  'permission denied for table audit_events',
  'alice: update of her own workspace audit events is denied (append-only)'
);

select throws_ok(
  format($sql$delete from public.audit_events where workspace_id = %L$sql$, tests.ws_b()),
  '42501',
  'permission denied for table audit_events',
  'alice: delete of workspace B audit events is denied'
);
select throws_ok(
  format($sql$delete from public.audit_events where workspace_id = %L$sql$, tests.ws_a()),
  '42501',
  'permission denied for table audit_events',
  'alice: delete of her own workspace audit events is denied (append-only)'
);

-- ---------------------------------------------------------------------------
-- Bob against Workspace A
-- ---------------------------------------------------------------------------
select tests.logout();
select tests.login_as(tests.bob());

select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_a()), 0,
  'bob: select of workspace A audit events returns 0 rows');
select results_eq(
  format('select action from public.audit_events where workspace_id = %L order by action', tests.ws_b()),
  array['member.added', 'workspace.created'],
  'bob: reads the two seed audit events of workspace B'
);
select throws_ok(
  format($sql$insert into public.audit_events (workspace_id, actor_id, action, entity_type) values (%L, %L, 'x.y', 'x')$sql$,
         tests.ws_a(), tests.bob()),
  '42501',
  null,
  'bob: insert of an audit event with workspace A id is denied'
);
select throws_ok(
  format($sql$update public.audit_events set metadata = '{}' where workspace_id = %L$sql$, tests.ws_a()),
  '42501',
  null,
  'bob: update of workspace A audit events is denied'
);
select throws_ok(
  format($sql$delete from public.audit_events where workspace_id = %L$sql$, tests.ws_a()),
  '42501',
  null,
  'bob: delete of workspace A audit events is denied'
);

select tests.logout();
select is((select count(*)::int from public.audit_events), 4,
  'postgres: the four seed audit events are intact');

select * from finish();
rollback;
