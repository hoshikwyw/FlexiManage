-- 16: custom value validation and field definition guards (migration 004).
--   * field_definitions.options / settings check constraints per type
--   * validate_record_custom_values(): object shape, unknown keys, required,
--     per-type checks, exact 23514 messages "custom_values.<key>: <reason>"
--   * validation runs on insert and on update of custom_values
--   * deleting a field strips its key from the module's records (also when
--     another record is stale-invalid: the nested update skips validation)
--   * key is immutable; type cannot change while values exist, can when none;
--     a select option in use cannot be removed; flipping required is allowed
--     and the record is caught on its next values edit
-- Fixtures (as postgres): module tests.mod_a in A with six fields; records are
-- written as alice through RLS, like the app does.
create extension if not exists pgtap with schema extensions;

begin;
select plan(56);
\ir helpers/tests_schema.sql.inc

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select tests.create_module(tests.mod_a(), tests.ws_a(), 'test-module-a');
select tests.create_field(tests.fld_a1(), tests.mod_a(), 'company', 'text', p_required => true, p_position => 0);
select tests.create_field(tests.fld_a2(), tests.mod_a(), 'notes',   'text',     p_position => 1);
select tests.create_field(tests.fld_a3(), tests.mod_a(), 'amount',  'number',   p_position => 2);
select tests.create_field(tests.fld_a4(), tests.mod_a(), 'due',     'date',     p_position => 3);
select tests.create_field(tests.fld_a5(), tests.mod_a(), 'done',    'checkbox', p_position => 4);
select tests.create_field(tests.fld_a6(), tests.mod_a(), 'stage',   'select',   p_position => 5,
  p_options => '[{"value": "new", "label": "New"}, {"value": "won", "label": "Won"}]');

-- ---------------------------------------------------------------------------
-- options / settings constraints (as postgres; pure check constraints)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad1', 'select')$sql$, tests.mod_a()),
  '23514', null, 'options: a select field needs at least one option');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad2', 'text', p_options => '[{"value": "a", "label": "A"}]')$sql$, tests.mod_a()),
  '23514', null, 'options: a text field must have [] options');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad3', 'select', p_options => '[{"value": "a"}]')$sql$, tests.mod_a()),
  '23514', null, 'options: every option needs value and label');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad4', 'select', p_options => '[{"value": "a", "label": "A"}, {"value": "a", "label": "Again"}]')$sql$, tests.mod_a()),
  '23514', null, 'options: option values must be distinct');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad5', 'select', p_options => '{"value": "a", "label": "A"}')$sql$, tests.mod_a()),
  '23514', null, 'options: must be an array');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad6', 'currency', p_settings => '[]')$sql$, tests.mod_a()),
  '23514', null, 'settings: must be an object');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad7', 'currency', p_settings => '{"currency": "eur"}')$sql$, tests.mod_a()),
  '23514', null, 'settings: currency code must be three upper-case letters');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'bad8', 'number', p_settings => '{"precision": 7}')$sql$, tests.mod_a()),
  '23514', null, 'settings: precision must be 0..6');
select throws_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'Bad-Key', 'text')$sql$, tests.mod_a()),
  '23514', null, 'key: must match ^[a-z][a-z0-9_]{0,49}$');
select lives_ok(
  format($sql$select tests.create_field(gen_random_uuid(), %L, 'price', 'currency', p_settings => '{"currency": "EUR", "precision": 2, "future_key": true}')$sql$, tests.mod_a()),
  'settings: a valid currency code and precision are accepted, unknown keys are kept');
delete from public.field_definitions where module_id = tests.mod_a() and key = 'price';

-- ---------------------------------------------------------------------------
-- Record validation on insert (as alice)
-- ---------------------------------------------------------------------------
select tests.login_as(tests.alice());

select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '["company"]')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values: expected object',
  'custom_values must be a JSON object');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "bogus": 1}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.bogus: unknown field',
  'unknown key is rejected, not dropped');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"zzz": 1}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.zzz: unknown field',
  'unknown key is reported before a missing required field');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.company: required',
  'required field absent');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": null}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.company: required',
  'required field null');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": ""}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.company: required',
  'required field empty string');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": 42}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.company: expected string',
  'text field with a number');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', %L)$sql$, tests.rec_a1(), tests.mod_a(),
         jsonb_build_object('company', 'X', 'notes', repeat('n', 2001))::text),
  '23514', 'custom_values.notes: text longer than 2000 characters',
  'text field longer than 2000 characters');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "amount": "12"}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.amount: expected number',
  'number field with a string');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "due": "2026/01/05"}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.due: expected date YYYY-MM-DD',
  'date field with the wrong format');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "due": "2026-13-45"}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.due: expected date YYYY-MM-DD',
  'date field with an impossible date');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "due": 20260105}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.due: expected date YYYY-MM-DD',
  'date field with a number');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "done": "true"}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.done: expected boolean',
  'checkbox field with a string');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "stage": 1}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.stage: expected string',
  'select field with a number');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "stage": "lost"}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.stage: not one of the options',
  'select field with a value outside the options');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X", "stage": "Won"}')$sql$, tests.rec_a1(), tests.mod_a()),
  '23514', 'custom_values.stage: not one of the options',
  'select option values are case-sensitive');

select lives_ok(
  format($sql$select tests.create_record(%L, %L, 'Full record',
    '{"company": "Zebrafish Ltd", "notes": "call back", "amount": 4200.5, "due": "2026-12-31", "done": false, "stage": "won"}')$sql$,
    tests.rec_a1(), tests.mod_a()),
  'a record with every field valid is accepted');
select lives_ok(
  format($sql$select tests.create_record(%L, %L, 'Minimal record', '{"company": "Yak Inc", "notes": null, "stage": null}')$sql$,
    tests.rec_a2(), tests.mod_a()),
  'null is accepted for non-required fields and only the required field is needed');
select is(tests.values_of(tests.rec_a2()), '{"company": "Yak Inc", "notes": null, "stage": null}'::jsonb,
  'values are stored as given (nulls kept)');

-- ---------------------------------------------------------------------------
-- Validation on update
-- ---------------------------------------------------------------------------
select throws_ok(
  format($sql$update public.records set custom_values = custom_values || '{"stage": "lost"}' where id = %L$sql$, tests.rec_a1()),
  '23514', 'custom_values.stage: not one of the options',
  'update of custom_values is validated');
select throws_ok(
  format($sql$update public.records set custom_values = custom_values - 'company' where id = %L$sql$, tests.rec_a1()),
  '23514', 'custom_values.company: required',
  'removing a required key on update is rejected');
select is(tests.rows_affected(format($sql$update public.records set custom_values = custom_values || '{"done": true, "amount": 100}' where id = %L$sql$, tests.rec_a1())),
  1, 'a valid update of custom_values is applied');

-- ---------------------------------------------------------------------------
-- Field definition guards (as alice, owner)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($sql$update public.field_definitions set key = 'remarks' where id = %L$sql$, tests.fld_a2()),
  '23514', 'field_definitions.key: cannot be changed',
  'renaming a key is blocked');
select throws_ok(
  format($sql$update public.field_definitions set type = 'text' where id = %L$sql$, tests.fld_a3()),
  '23514', 'field_definitions.type: cannot be changed while records have a value for "amount"',
  'type change is blocked while a record holds a value');
select throws_ok(
  format($sql$update public.field_definitions set type = 'number' where id = %L$sql$, tests.fld_a4()),
  '23514', 'field_definitions.type: cannot be changed while records have a value for "due"',
  'type change is blocked while a record holds a date value');
-- rec_a1 has due = "2026-12-31": set it to null first, then the change is allowed
select is(tests.rows_affected(format($sql$update public.records set custom_values = custom_values || '{"due": null}' where id = %L$sql$, tests.rec_a1())),
  1, 'clearing the only value of a field');
select lives_ok(
  format($sql$update public.field_definitions set type = 'number' where id = %L$sql$, tests.fld_a4()),
  'type change is allowed once no record holds a value (null counts as no value)');
select throws_ok(
  format($sql$update public.field_definitions set type = 'select' where id = %L$sql$, tests.fld_a4()),
  '23514', null,
  'type change to select without options fails the options check');
select lives_ok(
  format($sql$update public.field_definitions set type = 'select', options = '[{"value": "q1", "label": "Q1"}]' where id = %L$sql$, tests.fld_a4()),
  'type change to select with options succeeds when no record holds a value');

select throws_ok(
  format($sql$update public.field_definitions set options = '[{"value": "new", "label": "New"}]' where id = %L$sql$, tests.fld_a6()),
  '23514', 'field_definitions.options: option "won" is still used by records',
  'removing a select option that a record uses is blocked');
select lives_ok(
  format($sql$update public.field_definitions set options = '[{"value": "won", "label": "Won"}, {"value": "lost", "label": "Lost"}]' where id = %L$sql$, tests.fld_a6()),
  'removing an unused option and adding one is allowed');
select lives_ok(
  format($sql$update public.field_definitions set options = '[{"value": "won", "label": "Closed won"}, {"value": "lost", "label": "Lost"}]' where id = %L$sql$, tests.fld_a6()),
  'relabelling an option in use is allowed');

-- Flipping required on a field some records lack is allowed; those records are
-- caught on their next edit of custom_values, not on a title-only update.
select lives_ok(
  format($sql$update public.field_definitions set required = true where id = %L$sql$, tests.fld_a2()),
  'required can be turned on while records lack the value');
select is(tests.rows_affected(format($sql$update public.records set title = 'Minimal record (renamed)' where id = %L$sql$, tests.rec_a2())),
  1, 'a title-only update of a stale record still works');
select throws_ok(
  format($sql$update public.records set custom_values = custom_values || '{"stage": "lost"}' where id = %L$sql$, tests.rec_a2()),
  '23514', 'custom_values.notes: required',
  'the next edit of custom_values on a stale record reports the missing required field');
select throws_ok(
  format($sql$select tests.create_record(%L, %L, 'r', '{"company": "X"}')$sql$, tests.rec_a3(), tests.mod_a()),
  '23514', 'custom_values.notes: required',
  'new records must satisfy the now-required field');

-- ---------------------------------------------------------------------------
-- Field deletion strips the key from the module's records
-- ---------------------------------------------------------------------------
select ok(tests.values_of(tests.rec_a1()) ? 'amount', 'before: the record holds amount');
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a3())),
  1, 'owner: deletes the amount field (while rec_a2 is stale-invalid)');
select ok(not (tests.values_of(tests.rec_a1()) ? 'amount'), 'after: amount is gone from the record');
select is(tests.values_of(tests.rec_a1()),
  '{"company": "Zebrafish Ltd", "notes": "call back", "due": null, "done": true, "stage": "won"}'::jsonb,
  'after: every other value is intact');
select is(tests.values_of(tests.rec_a2()), '{"company": "Yak Inc", "notes": null, "stage": null}'::jsonb,
  'after: a record that never had the key is untouched');
select throws_ok(
  format($sql$update public.records set custom_values = custom_values || '{"amount": 1}' where id = %L$sql$, tests.rec_a1()),
  '23514', 'custom_values.amount: unknown field',
  'the deleted key is now unknown');

-- Deleting the stale required field heals rec_a2.
select is(tests.rows_affected(format($sql$delete from public.field_definitions where id = %L$sql$, tests.fld_a2())),
  1, 'owner: deletes the notes field');
select is(tests.rows_affected(format($sql$update public.records set custom_values = custom_values || '{"stage": "lost"}' where id = %L$sql$, tests.rec_a2())),
  1, 'the previously stale record can be edited again');
select is(tests.values_of(tests.rec_a2()), '{"company": "Yak Inc", "stage": "lost"}'::jsonb,
  'the notes key was stripped and the new stage value stored');

select tests.logout();
select is((select count(*)::int from public.records where module_id = tests.mod_a() and custom_values ?| array['amount', 'notes']), 0,
  'postgres: no record of the module still carries a deleted key');

select * from finish();
rollback;
