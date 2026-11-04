/**
 * Concurrency tests (code review gap, Part 17b): races that a single pgTAP transaction cannot
 * show, run against the local stack with two real database sessions.
 *
 *   npm run test:concurrency      (node --test tests/concurrency/concurrency.test.ts)
 *
 * No npm dependency: every session is a `psql` process (a host `psql` with the local URL when
 * one is on PATH, as on GitHub's ubuntu-latest, otherwise `docker exec -i
 * supabase_db_<project> psql`; `CONCURRENCY_DB_MODE=psql|docker` forces one) driven through
 * stdin. After every step the session prints a marker with psql's `:SQLSTATE`, so the test
 * knows when a statement finished and how. Interleavings are forced, not hoped for:
 *
 * - ordered cases: session 1 runs its statement inside an open transaction; session 2 starts
 *   its conflicting statement and the observer session waits until `pg_stat_activity` shows it
 *   waiting on a lock; then session 1 commits and session 2 finishes;
 * - simultaneous cases: an observer holds an advisory "gate" lock; both sessions queue on it
 *   (`pg_advisory_xact_lock_shared`) with their statement behind it, the gate opens and both
 *   race; whichever finishes first commits first.
 *
 * Writers act as the fixture user through `set role authenticated` plus `request.jwt.claims`,
 * the way PostgREST does, so RLS and the column grants apply. Fixtures (tests/fixtures/
 * concurrency.ts) are committed at the start and removed at the end (account deletion cascades
 * the workspace; the queue rows of its never-uploaded attachments are deleted too).
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'

import { CONCURRENCY as F } from '../fixtures/concurrency.ts'

const DB_URL =
  process.env.CONCURRENCY_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const PROJECT_ID =
  /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1] ??
  'fleximanage'
const DB_CONTAINER = `supabase_db_${PROJECT_ID}`
/** How long a session may take to reach the expected lock wait or to finish a step. */
const STEP_TIMEOUT_MS = 20_000
/** Key of the observer's gate lock (arbitrary, only used by this file). */
const GATE_KEY = 727_001
/** wait_event of a backend waiting for another transaction's row lock. */
const ROW_LOCK_WAIT = /^(transactionid|tuple)$/

function hostPsqlAvailable(): boolean {
  const forced = process.env.CONCURRENCY_DB_MODE
  if (forced === 'psql') return true
  if (forced === 'docker') return false
  return spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0
}

const HOST_PSQL = hostPsqlAvailable()
/** CONCURRENCY_DEBUG=1 echoes every step and all psql output to stderr. */
const DEBUG = process.env.CONCURRENCY_DEBUG === '1'

interface StepResult {
  /** psql's SQLSTATE of the step's last statement: `00000` on success. */
  sqlstate: string
  /** LAST_ERROR_MESSAGE when sqlstate is not 00000. */
  error: string
  /** Tuples-only output lines of the step. */
  rows: string[]
}

let sessionCount = 0

/** One psql process = one database session; steps are sent one at a time through stdin. */
class Session {
  readonly label: string
  readonly appName: string
  private readonly proc: ChildProcessWithoutNullStreams
  private stdoutBuffer = ''
  private pendingRows: string[] = []
  private readonly waiters = new Map<number, (result: StepResult) => void>()
  private seq = 0
  private stderr = ''
  private exited = false

  constructor(label: string) {
    this.label = label
    sessionCount += 1
    this.appName = `concurrency_${process.pid}_${sessionCount}_${label}`
    const psqlArgs = ['-X', '-q', '-At', '-v', 'VERBOSITY=terse']
    this.proc = HOST_PSQL
      ? spawn('psql', [DB_URL, ...psqlArgs], {
          env: { ...process.env, PGAPPNAME: this.appName },
        })
      : spawn('docker', [
          'exec',
          '-i',
          '-e',
          `PGAPPNAME=${this.appName}`,
          DB_CONTAINER,
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          ...psqlArgs,
        ])
    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    this.proc.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    this.proc.on('exit', () => {
      this.exited = true
    })
  }

  private onStdout(chunk: string): void {
    if (DEBUG) process.stderr.write(`[${this.label} out] ${chunk}`)
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      const marker = /^__STEP_(\d+)__ (\S+) ?(.*)$/.exec(line)
      if (marker) {
        const [, n, sqlstate = '', message = ''] = marker
        const rows = this.pendingRows
        this.pendingRows = []
        this.waiters.get(Number(n))?.({
          sqlstate,
          error: sqlstate === '00000' ? '' : message,
          rows,
        })
        this.waiters.delete(Number(n))
      } else {
        this.pendingRows.push(line)
      }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  /** Send one step (one or more statements); resolves when psql has executed all of it. */
  send(statements: string): Promise<StepResult> {
    this.seq += 1
    const n = this.seq
    const done = new Promise<StepResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(n)
        reject(
          new Error(
            `[${this.label}] step ${n} did not finish within ${STEP_TIMEOUT_MS} ms: ${statements}\n${this.stderr}`,
          ),
        )
      }, STEP_TIMEOUT_MS)
      this.waiters.set(n, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
    })
    // psql runs a statement only once it sees the terminating semicolon; a backslash command
    // before that would print the marker with the previous SQLSTATE.
    const sqlText = statements.trimEnd().endsWith(';') ? statements : `${statements};`
    if (DEBUG) process.stderr.write(`[${this.label} in] ${sqlText}\n`)
    this.proc.stdin.write(`${sqlText}\n\\echo __STEP_${n}__ :SQLSTATE :LAST_ERROR_MESSAGE\n`)
    return done
  }

  /** Like send, but fails the test unless the step succeeded. */
  async ok(statements: string): Promise<string[]> {
    const result = await this.send(statements)
    assert.equal(
      result.sqlstate,
      '00000',
      `[${this.label}] expected success: ${statements}\n${result.error}`,
    )
    return result.rows
  }

  async one(query: string): Promise<string> {
    const rows = await this.ok(query)
    return rows.join('\n').trim()
  }

  /** Act as the fixture user, the way PostgREST does (role + JWT claims, RLS applies). */
  async impersonate(userId: string): Promise<void> {
    await this.ok(
      `set role authenticated; select set_config('request.jwt.claims', ` +
        `'{"sub": "${userId}", "role": "authenticated"}', false) is not null;`,
    )
  }

  async close(): Promise<void> {
    if (this.exited) return
    const gone = new Promise<void>((resolve) => this.proc.on('exit', () => resolve()))
    this.proc.stdin.end('\\q\n')
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))])
    if (!this.exited) this.proc.kill()
  }
}

/** A SQL string literal. */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

let observer: Session

/** Wait until the session's backend waits on a lock (`wait_event_type = 'Lock'`). */
async function waitUntilBlocked(session: Session, step: Promise<StepResult>): Promise<string> {
  let finished = false
  void step.then(
    () => (finished = true),
    () => (finished = true),
  )
  const deadline = Date.now() + STEP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const waiting = await observer.one(
      `select coalesce(string_agg(wait_event, ','), '') from pg_stat_activity ` +
        `where application_name = ${lit(session.appName)} and state = 'active' and wait_event_type = 'Lock'`,
    )
    if (waiting) return waiting
    if (finished) {
      throw new Error(`[${session.label}] finished without waiting on a lock`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`[${session.label}] never waited on a lock`)
}

interface RaceOutcome {
  first: { label: string; result: StepResult }
  second: { label: string; result: StepResult; waitedOn: string }
}

/**
 * Run `statementOf(session)` in both sessions inside open transactions, released together by
 * the gate. The session that finishes first commits first; the other must be waiting on a lock
 * at that moment (the serialisation under test) and finishes after the commit, then commits
 * (a failed transaction's commit is a rollback).
 */
async function race(
  a: Session,
  b: Session,
  statementOf: (session: Session) => string,
): Promise<RaceOutcome> {
  await observer.ok(`select pg_advisory_lock(${GATE_KEY});`)
  await a.ok('begin;')
  await b.ok('begin;')
  const stepA = a.send(`select pg_advisory_xact_lock_shared(${GATE_KEY}); ${statementOf(a)}`)
  const stepB = b.send(`select pg_advisory_xact_lock_shared(${GATE_KEY}); ${statementOf(b)}`)
  await waitUntilBlocked(a, stepA)
  await waitUntilBlocked(b, stepB)
  await observer.ok(`select pg_advisory_unlock(${GATE_KEY});`)

  const winner = await Promise.race([
    stepA.then((result) => ({ session: a, result, other: b, otherStep: stepB })),
    stepB.then((result) => ({ session: b, result, other: a, otherStep: stepA })),
  ])
  const waitedOn = await waitUntilBlocked(winner.other, winner.otherStep)
  await winner.session.send('commit;')
  const loserResult = await winner.otherStep
  await winner.other.send('commit;')
  return {
    first: { label: winner.session.label, result: winner.result },
    second: { label: winner.other.label, result: loserResult, waitedOn },
  }
}

const U = F.user.id
const WS = F.workspace.id
const MOD = F.module.id
const X = F.fields.x
const STAGE = F.fields.stage

const STAGE_OPTIONS_ABC =
  '[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}, {"value": "c", "label": "C"}]'
const STAGE_OPTIONS_AB = '[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}]'

async function removeFixtures(): Promise<void> {
  await observer.ok(
    `delete from auth.users where id = ${lit(U)}; ` +
      `delete from public.storage_deletion_queue where workspace_id = ${lit(WS)};`,
  )
}

async function createFixtures(): Promise<void> {
  await observer.ok(
    `begin;
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', ${lit(U)}, 'authenticated', 'authenticated',
        ${lit(F.user.email)}, '{"provider": "email", "providers": ["email"]}',
        '{"full_name": "Concurrency Owner"}', now(), now(), now());
insert into public.workspaces (id, name, slug, created_by)
values (${lit(WS)}, 'Concurrency tests', ${lit(F.workspace.slug)}, ${lit(U)});
insert into public.modules (id, workspace_id, name, slug, created_by)
values (${lit(MOD)}, ${lit(WS)}, 'Concurrency', ${lit(F.module.slug)}, ${lit(U)});
insert into public.field_definitions (id, workspace_id, module_id, key, label, type, required, position, options)
values (${lit(F.fields.company.id)}, ${lit(WS)}, ${lit(MOD)}, 'company', 'Company', 'text', true, 0, '[]'),
       (${lit(X.id)}, ${lit(WS)}, ${lit(MOD)}, ${lit(X.key)}, 'X', 'text', false, 1, '[]'),
       (${lit(STAGE.id)}, ${lit(WS)}, ${lit(MOD)}, ${lit(STAGE.key)}, 'Stage', 'select', false, 2, '${STAGE_OPTIONS_ABC}');
insert into public.records (id, workspace_id, module_id, title, custom_values, created_by)
values (${lit(F.records.files.id)}, ${lit(WS)}, ${lit(MOD)}, 'Files', '{"company": "Files"}', ${lit(U)}),
       (${lit(F.records.versioned.id)}, ${lit(WS)}, ${lit(MOD)}, 'Versioned', '{"company": "Start"}', ${lit(U)});
insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes, uploaded_by)
select ${lit(WS)}, ${lit(F.records.files.id)}, 'file-' || g || '.txt', 'text/plain', 10, ${lit(U)}
from generate_series(1, 9) g;
update public.attachments set uploaded_at = now() where record_id = ${lit(F.records.files.id)};
commit;`,
  )
}

let s1: Session
let s2: Session

before(async () => {
  observer = new Session('observer')
  await removeFixtures()
  await createFixtures()
  s1 = new Session('s1')
  s2 = new Session('s2')
  await s1.impersonate(U)
  await s2.impersonate(U)
})

after(async () => {
  try {
    if (observer) await removeFixtures()
  } finally {
    await Promise.all([s1?.close(), s2?.close(), observer?.close()])
  }
})

describe('(a) attachment cap of 10 under concurrent inserts', () => {
  it('lets exactly one of two simultaneous inserts on a record with 9 uploaded files succeed', async () => {
    assert.equal(
      await observer.one(
        `select count(*) from public.attachments where record_id = ${lit(F.records.files.id)} and uploaded_at is not null`,
      ),
      '9',
    )
    const outcome = await race(
      s1,
      s2,
      (session) =>
        `insert into public.attachments (workspace_id, record_id, file_name, content_type, size_bytes) ` +
        `values (${lit(WS)}, ${lit(F.records.files.id)}, 'tenth-${session.label}.txt', 'text/plain', 10);`,
    )
    assert.equal(outcome.first.result.sqlstate, '00000', outcome.first.result.error)
    assert.equal(outcome.second.waitedOn, 'advisory')
    assert.equal(outcome.second.result.sqlstate, '23514')
    assert.match(outcome.second.result.error, /attachments: at most 10 files per record/)
    assert.equal(
      await observer.one(
        `select string_agg(file_name, ',') from public.attachments ` +
          `where record_id = ${lit(F.records.files.id)} and file_name like 'tenth-%'`,
      ),
      `tenth-${outcome.first.label}.txt`,
    )
    assert.equal(
      await observer.one(
        `select count(*) from public.attachments where record_id = ${lit(F.records.files.id)}`,
      ),
      '10',
    )
  })
})

/** No record of the fixture module holds the key `x`. */
async function recordsWithX(): Promise<string> {
  return observer.one(
    `select count(*) from public.records where module_id = ${lit(MOD)} and custom_values ? ${lit(X.key)}`,
  )
}

async function recreateFieldX(): Promise<void> {
  await observer.ok(
    `insert into public.field_definitions (id, workspace_id, module_id, key, label, type, required, position, options)
     values (${lit(X.id)}, ${lit(WS)}, ${lit(MOD)}, ${lit(X.key)}, 'X', 'text', false, 1, '[]')
     on conflict (id) do nothing;`,
  )
}

function insertRecordWith(title: string, values: Record<string, string>): string {
  const json = JSON.stringify({ company: title, ...values })
  return (
    `insert into public.records (workspace_id, module_id, title, custom_values, created_by) ` +
    `values (${lit(WS)}, ${lit(MOD)}, ${lit(title)}, ${lit(json)}::jsonb, ${lit(U)});`
  )
}

describe('(b) deleting a field while another transaction writes it', () => {
  it('strips x from a record inserted just before the field delete', async () => {
    await recreateFieldX()
    await s1.ok('begin;')
    await s1.ok(insertRecordWith('b-insert-first', { x: 'orphan?' }))
    await s2.ok('begin;')
    const deleting = s2.send(`delete from public.field_definitions where id = ${lit(X.id)};`)
    assert.match(await waitUntilBlocked(s2, deleting), ROW_LOCK_WAIT)
    await s1.ok('commit;')
    assert.equal((await deleting).sqlstate, '00000')
    await s2.ok('commit;')

    assert.equal(await recordsWithX(), '0')
    assert.equal(
      await observer.one(
        `select count(*) from public.records where module_id = ${lit(MOD)} and title = 'b-insert-first'`,
      ),
      '1',
    )
  })

  it('rejects a record insert with x that waited for the field delete', async () => {
    await recreateFieldX()
    await s2.ok('begin;')
    await s2.ok(`delete from public.field_definitions where id = ${lit(X.id)};`)
    await s1.ok('begin;')
    const inserting = s1.send(insertRecordWith('b-delete-first', { x: 'orphan?' }))
    assert.match(await waitUntilBlocked(s1, inserting), ROW_LOCK_WAIT)
    await s2.ok('commit;')
    const result = await inserting
    await s1.send('commit;')

    assert.equal(result.sqlstate, '23514')
    assert.match(result.error, /custom_values\.x/)
    assert.equal(await recordsWithX(), '0')
    assert.equal(
      await observer.one(`select count(*) from public.field_definitions where id = ${lit(X.id)}`),
      '0',
    )
  })

  it('never leaves x behind when the delete and an insert are released together', async () => {
    await recreateFieldX()
    const outcome = await race(s1, s2, (session) =>
      session === s1
        ? insertRecordWith('b-race', { x: 'orphan?' })
        : `delete from public.field_definitions where id = ${lit(X.id)};`,
    )
    // Either order is valid; the invariant is that no record keeps the deleted key.
    const results = [outcome.first, outcome.second]
    const deleteResult = results.find((r) => r.label === 's2')?.result
    assert.equal(deleteResult?.sqlstate, '00000')
    assert.equal(await recordsWithX(), '0')
  })
})

/** Records whose stage value is not one of the field's current options. */
async function stagesOutsideOptions(): Promise<string> {
  return observer.one(
    `select count(*) from public.records r where r.module_id = ${lit(MOD)} ` +
      `and r.custom_values ? 'stage' and not exists (` +
      `select 1 from public.field_definitions f, jsonb_array_elements(f.options) o ` +
      `where f.id = ${lit(STAGE.id)} and o ->> 'value' = r.custom_values ->> 'stage')`,
  )
}

async function resetStageOptions(): Promise<void> {
  await observer.ok(
    `delete from public.records where module_id = ${lit(MOD)} and custom_values ? 'stage'; ` +
      `update public.field_definitions set options = '${STAGE_OPTIONS_ABC}' where id = ${lit(STAGE.id)};`,
  )
}

const removeOptionC = `update public.field_definitions set options = '${STAGE_OPTIONS_AB}' where id = ${lit(STAGE.id)};`

describe('(c) removing a select option while another transaction writes it', () => {
  it('refuses to remove an option a just-committed record uses', async () => {
    await resetStageOptions()
    await s1.ok('begin;')
    await s1.ok(insertRecordWith('c-write-first', { stage: 'c' }))
    await s2.ok('begin;')
    const removing = s2.send(removeOptionC)
    assert.match(await waitUntilBlocked(s2, removing), ROW_LOCK_WAIT)
    await s1.ok('commit;')
    const result = await removing
    await s2.send('commit;')

    assert.equal(result.sqlstate, '23514')
    assert.match(result.error, /option "c" is still used by records/)
    assert.equal(await stagesOutsideOptions(), '0')
  })

  it('rejects writing an option that was removed while the write waited', async () => {
    await resetStageOptions()
    await s2.ok('begin;')
    await s2.ok(removeOptionC)
    await s1.ok('begin;')
    const writing = s1.send(insertRecordWith('c-remove-first', { stage: 'c' }))
    assert.match(await waitUntilBlocked(s1, writing), ROW_LOCK_WAIT)
    await s2.ok('commit;')
    const result = await writing
    await s1.send('commit;')

    assert.equal(result.sqlstate, '23514')
    assert.match(result.error, /custom_values\.stage/)
    assert.equal(await stagesOutsideOptions(), '0')
  })

  it('never stores a value outside the options when both are released together', async () => {
    await resetStageOptions()
    await race(s1, s2, (session) =>
      session === s1 ? insertRecordWith('c-race', { stage: 'c' }) : removeOptionC,
    )
    assert.equal(await stagesOutsideOptions(), '0')
  })
})

describe('(d) update_record with the same expected timestamp', () => {
  it('lets exactly one of two simultaneous calls succeed and answers the other PT409', async () => {
    const expected = await observer.one(
      `select updated_at::text from public.records where id = ${lit(F.records.versioned.id)}`,
    )
    const outcome = await race(
      s1,
      s2,
      (session) =>
        `select (public.update_record(${lit(F.records.versioned.id)}, ${lit(expected)}::timestamptz, ` +
        `'{"set": {"company": "${session.label}"}}'::jsonb)).id;`,
    )
    assert.equal(outcome.first.result.sqlstate, '00000', outcome.first.result.error)
    assert.match(outcome.second.waitedOn, ROW_LOCK_WAIT)
    assert.equal(outcome.second.result.sqlstate, 'PT409')
    assert.match(outcome.second.result.error, /record_changed/)
    assert.equal(
      await observer.one(
        `select custom_values ->> 'company' from public.records where id = ${lit(F.records.versioned.id)}`,
      ),
      outcome.first.label,
    )
    assert.notEqual(
      await observer.one(
        `select updated_at::text from public.records where id = ${lit(F.records.versioned.id)}`,
      ),
      expected,
    )
  })
})
