-- 05: cross-workspace isolation on public.audit_events.
-- Members read their own workspace's log and nothing else; authenticated can
-- never insert, update or delete (the log is written by triggers and Edge
-- Functions only). Covers the four section 7 matrix cells for `audit_events`.
--
-- Independent of pre-existing rows: the log is append-only, so "reads exactly
-- the two creation events" is asserted on workspaces C and D created inside
-- the transaction by alice and bob; the final intactness check is a delta on
-- the total captured after the fixtures.
create extension if not exists pgtap with schema extensions;

begin;
select plan(16);
\ir helpers/tests_schema.sql.inc

create function tests.ws_c() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000cc'::uuid $$;
create function tests.ws_d() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-0000000000dd'::uuid $$;

-- ---------------------------------------------------------------------------
-- Fixtures: each seed user creates one workspace as themselves (trigger writes
-- workspace.created and member.added with the creator as actor).
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());
insert into public.workspaces (id, name, slug, created_by) values (tests.ws_c(), 'Workspace C', 'workspace-c', tests.alice());
select tests.logout();
select tests.login_as(tests.bob());
insert into public.workspaces (id, name, slug, created_by) values (tests.ws_d(), 'Workspace D', 'workspace-d', tests.bob());
select tests.logout();

select tests.remember_count('audit_total', (select count(*) from public.audit_events));

-- ---------------------------------------------------------------------------
-- Alice against Workspace B
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select is((select count(*)::int from public.audit_events where workspace_id = tests.ws_b()), 0,
  'alice: select of workspace B audit events returns 0 rows');
select results_eq(
  format('select action from public.audit_events where workspace_id = %L order by action', tests.ws_c()),
  array['member.added', 'workspace.created'],
  'alice: reads exactly the two creation events of the workspace she just created'
);
select ok(
  exists (select 1 from public.audit_events where workspace_id = tests.ws_a() and action = 'workspace.created'),
  'alice: reads the workspace.created event of workspace A');
select is_empty(
  format($sql$select workspace_id from public.audit_events
          except select workspace_id from public.workspace_members where user_id = %L$sql$, tests.alice()),
  'alice: sees no audit event outside her own workspaces');

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
  format('select action from public.audit_events where workspace_id = %L order by action', tests.ws_d()),
  array['member.added', 'workspace.created'],
  'bob: reads exactly the two creation events of the workspace he just created'
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
select is((select count(*)::int from public.audit_events), tests.recall_count('audit_total'),
  'postgres: the denied attempts added or removed no audit event');

select * from finish();
rollback;
