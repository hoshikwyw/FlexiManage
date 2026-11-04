-- 18: search and workspace_usage() (migration 004).
--   * search_vector is generated from title, status and the string/number
--     custom values; full-text search finds a record by a custom value word,
--     by title and by status; it follows updates; booleans are not indexed
--   * ILIKE on title works (the trigram index was dropped in migration 006)
--     and the GIN indexes exist; the C4 tokenizer queries are in 21
--   * search_vector cannot be written, even as postgres (generated column)
--   * workspace_usage(): correct counts for a member, 42501 for a non-member,
--     permission denied for anon
-- Fixtures (as postgres): module tests.mod_a with two fields and two records.
-- Counts are deltas against the state captured before the fixtures.
create extension if not exists pgtap with schema extensions;

begin;
select plan(26);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select tests.remember_count('a_modules', (select count(*) from public.modules where workspace_id = tests.ws_a()));
select tests.remember_count('a_records', (select count(*) from public.records where workspace_id = tests.ws_a()));
select tests.remember_count('a_members', (select count(*) from public.workspace_members where workspace_id = tests.ws_a()));

select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_field(tests.fld_a1(), tests.mod_a(), 'company', 'text');
select tests.create_field(tests.fld_a2(), tests.mod_a(), 'amount', 'number');
select tests.create_field(tests.fld_a3(), tests.mod_a(), 'done', 'checkbox');
select tests.create_record(tests.rec_a1(), tests.mod_a(), 'Quarterly review',
  '{"company": "Zebrafish Ltd", "amount": 4200, "done": true}', p_status => 'open');
select tests.create_record(tests.rec_a2(), tests.mod_a(), 'Annual plan', '{"company": "Yak Inc"}');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_index('public', 'records', 'records_search_vector_idx', 'GIN index on search_vector exists');
select hasnt_index('public', 'records', 'records_title_trgm_idx', 'the title trigram index is gone (migration 006; the ILIKE fallback runs on the module-scoped rows)');
select has_index('public', 'records', 'records_custom_values_idx', 'GIN jsonb_path_ops index on custom_values exists');
select has_index('public', 'records', 'records_workspace_module_created_idx', 'listing index (workspace_id, module_id, created_at desc) exists');
select has_extension('extensions', 'pg_trgm', 'pg_trgm is installed in the extensions schema');
select is(
  (select attgenerated from pg_attribute where attrelid = 'public.records'::regclass and attname = 'search_vector'),
  's', 'search_vector is a stored generated column');
select throws_ok(
  format($sql$update public.records set search_vector = to_tsvector('x') where id = %L$sql$, tests.rec_a1()),
  '428C9', null,
  'postgres: even the owner cannot write search_vector (generated column)');

-- ---------------------------------------------------------------------------
-- Search (as alice)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select results_eq(
  format($sql$select id from public.records where workspace_id = %L and search_vector @@ to_tsquery('simple', 'zebrafish')$sql$, tests.ws_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'full text: finds a record by a word of a custom text value');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and search_vector @@ to_tsquery('simple', 'quarterly')$sql$, tests.ws_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'full text: finds a record by a word of the title');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and search_vector @@ to_tsquery('simple', '4200')$sql$, tests.ws_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'full text: finds a record by a custom number value');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and module_id = %L and search_vector @@ to_tsquery('simple', 'open')$sql$, tests.ws_a(), tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'full text: finds a record by status');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and search_vector @@ plainto_tsquery('simple', 'yak inc')$sql$, tests.ws_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a2()),
  'full text: plainto_tsquery with two words finds the record holding both');
select is((select count(*)::int from public.records where module_id = tests.mod_a() and search_vector @@ to_tsquery('simple', 'true')), 0,
  'full text: boolean values are not indexed');
select is((select count(*)::int from public.records where module_id = tests.mod_a() and search_vector @@ to_tsquery('simple', 'zebra')), 0,
  'full text: a prefix without :* does not match (use ILIKE or zebra:*)');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and search_vector @@ to_tsquery('simple', 'zebra:*')$sql$, tests.ws_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'full text: prefix matching works with :*');

select is(tests.rows_affected(format($sql$update public.records set custom_values = custom_values || '{"company": "Wombat GmbH"}' where id = %L$sql$, tests.rec_a1())),
  1, 'alice: changes the custom value');
select is((select count(*)::int from public.records where module_id = tests.mod_a() and search_vector @@ to_tsquery('simple', 'zebrafish')), 0,
  'full text: the old value is no longer found after the update');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and search_vector @@ to_tsquery('simple', 'wombat')$sql$, tests.ws_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'full text: the new value is found after the update');

select results_eq(
  format($sql$select id from public.records where workspace_id = %L and module_id = %L and title ilike 'quart%%'$sql$, tests.ws_a(), tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a1()),
  'trigram: ILIKE prefix on title finds the record');
select results_eq(
  format($sql$select id from public.records where workspace_id = %L and module_id = %L and title ilike '%%PLAN%%'$sql$, tests.ws_a(), tests.mod_a()),
  format($sql$values (%L::uuid)$sql$, tests.rec_a2()),
  'trigram: case-insensitive infix on title finds the record');

-- ---------------------------------------------------------------------------
-- workspace_usage()
-- ---------------------------------------------------------------------------
select results_eq(
  format($sql$select modules, records, members from public.workspace_usage(%L)$sql$, tests.ws_a()),
  format($sql$values (%s, %s, %s)$sql$,
         tests.recall_count('a_modules') + 1, tests.recall_count('a_records') + 2, tests.recall_count('a_members')),
  'member: workspace_usage(A) counts the fixture module and records on top of what existed');
select throws_ok(
  format($sql$select * from public.workspace_usage(%L)$sql$, tests.ws_b()),
  '42501', 'not a member of this workspace',
  'non-member: workspace_usage(B) raises 42501');
select throws_ok(
  $sql$select * from public.workspace_usage(gen_random_uuid())$sql$,
  '42501', 'not a member of this workspace',
  'unknown workspace: workspace_usage raises the same 42501 (existence not revealed)');

select tests.logout();
select tests.login_as(tests.bob());
select results_eq(
  format($sql$select modules >= 0 and records >= 0 and members >= 1 from public.workspace_usage(%L)$sql$, tests.ws_b()),
  $sql$values (true)$sql$,
  'bob: workspace_usage(B) answers for his own workspace');
select tests.logout();

select tests.login_as_anon();
select throws_ok(
  format($sql$select * from public.workspace_usage(%L)$sql$, tests.ws_a()),
  '42501', 'permission denied for function workspace_usage',
  'anon: cannot execute workspace_usage');
select tests.logout();

select throws_ok(
  format($sql$select * from public.workspace_usage(%L)$sql$, tests.ws_a()),
  '42501', 'not a member of this workspace',
  'no JWT (service role / postgres): workspace_usage raises 42501, it is for members only');

select * from finish();
rollback;
