# Operations

Runtime and tooling notes for operators. Updated by the `devops-engineer` and `supabase-engineer`
agents. Last updated: 2026-11-04 (migration 005: attachments bucket, deletion queue and purge
procedure, test files `19` and `20`, `export-records` and `purge-attachments`).

## Production prerequisites

Mandatory GoTrue settings for the staging and production Supabase projects, under
Authentication -> Providers -> Email (the hosted equivalents of `[auth.email]` in
`supabase/config.toml`):

| Setting                          | Required value | Why                                                                                                                                          |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable_confirmations`           | `true`         | `accept_invitation()` only admits a caller whose `auth.users.email_confirmed_at` is set. Without confirmation anyone could sign up with an invitee's address and join their workspace. |
| `double_confirm_changes`         | `true`         | An email change must be confirmed from both addresses before `auth.users.email` (and, through the `on_auth_user_email_changed` trigger, `profiles.email`) changes; otherwise a signed-in user could switch to an invitee's address and accept their invitation. |

Local development deliberately sets `enable_confirmations = false` (`supabase/config.toml`) so
sign-up signs in immediately and Mailpit captures the mail; this is why the seed users carry
`email_confirmed_at`. The Phase 5 checklist in `docs/PLANNING.md` includes verifying both values
on staging and production before the first pilot; the `security-reviewer` treats a project with
either value off as a Critical finding.

Account deletion (migration 003, `docs/architecture.md`, "Account deletion") runs entirely in
Postgres triggers on `auth.users`, so deleting a user from the dashboard or the admin API is safe:
solely-owned workspaces are handed to the longest-standing admin or member, or deleted when the
user was alone.

## Environments

| Environment | Where                              | Env file               | Notes                                             |
| ----------- | ---------------------------------- | ---------------------- | ------------------------------------------------- |
| Local       | `npm run dev` + local Supabase CLI | `.env.local` (ignored) | Copy from `.env.example`; see Local Supabase below. |
| CI          | GitHub Actions                     | placeholder values     | Build does not need real credentials.             |
| Staging     | not yet created                    | GitHub Actions secrets | Phase 5.                                          |
| Production  | not yet created                    | GitHub Actions secrets | Phase 5. Separate Supabase project from staging.  |

Browser variables are prefixed `VITE_` and contain only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The app throws at startup if either is missing
(`src/lib/supabase.ts`). The service-role key and payment secrets are never placed in `.env*`
files, browser code or docs; they live in GitHub Actions secrets (CI) or Supabase function
secrets (Edge Functions).

## Toolchain

- Node 24, npm 11. `package.json` declares `engines.node >= 24`.
- TypeScript 5.9 (strict). TypeScript 7 is not used yet because `typescript-eslint` 8 does not
  support it.
- Vite 8, Vitest 5, Tailwind CSS 4 (via `@tailwindcss/vite`, no `tailwind.config` file).
- shadcn/ui 4 with the default `base-nova` style (Base UI primitives, Geist font). Components
  are added with `npx shadcn@latest add <name>` and live in `src/components/ui`.
- Playwright browsers are not installed by `npm ci`. Run
  `npx playwright install --with-deps chromium` locally or in the e2e CI job.
- Line endings: `.gitattributes` enforces LF for every text file (`* text=auto eol=lf`) and marks
  images and fonts binary. No `core.autocrlf` setting is required; a checkout on Windows is LF and
  `npm run format:check` matches CI.
- `npm run typecheck` runs `tsc -b` over the three projects referenced by `tsconfig.json`:
  `tsconfig.app.json` (src, including co-located `*.test.tsx`), `tsconfig.node.json`
  (Vite/Vitest/Playwright configs) and `tsconfig.test.json` (`tests/`).
- `shadcn` is a devDependency (CLI only); it is never bundled.
- `npm run test:e2e` serves the app with the Vite dev server on `http://localhost:5173` using
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the environment or the `.env*` files;
  without them `playwright.config.ts` injects placeholders, the unauthenticated smoke spec runs and
  every other spec skips itself. See "End-to-end tests" below.

## Local Supabase

The local stack (Postgres 17, Auth, PostgREST, Storage, Studio, Inbucket mail) is defined in
`supabase/config.toml` (`project_id = "fleximanage"`) and runs in Docker.

Requirements: Docker Desktop running (`docker info` must succeed) and the Supabase CLI
(`npx supabase --version`, 2.122.0 at the time of writing; the bare `supabase` command works when
the CLI is installed globally).

| Command                             | What it does                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run db:start`                  | `supabase start`: pull images on first run and start the stack. Prints the API URL, anon key and Studio URL. |
| `npx supabase status`               | Show URLs and keys of the running stack.                                                                    |
| `npm run db:reset`                  | `supabase db reset`: drop the local database, re-apply every file in `supabase/migrations`, run `seed.sql`. |
| `npm run db:types`                  | `supabase gen types typescript --local > src/types/supabase.ts`. Run after every migration change.          |
| `npm run test:db`                   | `supabase test db`: run every `supabase/tests/*.sql` file with pgTAP (pg_prove in a container) against the local database, fresh or used. |
| `npm run test:db:fresh`             | `supabase db reset && supabase test db`: the CI-equivalent run against a freshly seeded database.           |
| `npm run db:dirty`                  | Apply `scripts/db/dirty-state.sql` through `docker exec ... psql` to simulate a manual testing session (local only). |
| `npx supabase migration new <name>` | Create an empty timestamped migration file.                                                                 |
| `npm run functions:serve`           | `supabase functions serve`: serve every folder in `supabase/functions` at `http://127.0.0.1:54321/functions/v1/<name>` with hot reload. See Edge Functions below. |
| `npm run db:stop`                   | `supabase stop`: stop the containers (data is kept in a Docker volume; `--no-backup` discards it).          |

### Database tests

`npm run test:db` needs the stack running (`npm run db:start`) and a database whose schema matches
the migrations (`npm run db:reset` after any schema or seed change). The CLI installs the `pgtap`
extension in the `extensions` schema if it is missing and runs `pg_prove` over `supabase/tests`
(recursively, `*.sql` only) in file-name order.

Two runs matter:

- `npm run test:db` must pass on a **used** database: after manual testing in the app, Studio or
  psql has added users, workspaces, invitations and (append-only) audit rows, without a reset.
- `npm run test:db:fresh` (`db:reset` then `test:db`) is the CI-equivalent run on a freshly seeded
  database. CI runs `supabase start` and `supabase test db`, which is the same thing.

To check the first locally, `npm run db:dirty` applies `scripts/db/dirty-state.sql` as `postgres`
(three extra users, two extra workspaces, alice as admin of one, four invitations in A of which
one is accepted through `accept_invitation()` and one revoked, workspace A renamed and renamed
back, every profile re-saved). It is re-runnable and lives outside `supabase/tests` so pg_prove
never collects it. `npm run db:reset` returns to the seed.

Conventions (2026-11-03, Part 8b):

- Files are numbered (`01_rls_enabled.sql` ... `20_storage_policies.sql`; 20 files, 850 tests as
  of migration 005) and each wraps everything in `begin; select plan(N); ... select * from
  finish(); rollback;`, so a run leaves no data behind. `01` holds the structural totals (table
  count, function count, grants, policy names) and must be updated by every migration; `13` to
  `18` cover the content model (isolation of modules, fields and records, custom value
  validation, role rules and audit, search and `workspace_usage`); `19` and `20` cover
  attachments (table isolation, checks, cap, audit, deletion queue, usage) and the `attachments`
  bucket's `storage.objects` policies.
- The shared helpers live in `supabase/tests/helpers/tests_schema.sql.inc` and are pulled in with
  `\ir helpers/tests_schema.sql.inc` right after `select plan(N)` (psql resolves `\ir` relative to
  the including file, also inside the pg_prove container; the `.sql.inc` extension keeps pg_prove
  from running it as a test). It creates the transaction-local `tests` schema with `login_as(uuid)`,
  `login_as_anon()`, `logout()`, `rows_affected(sql)`, `create_user(id, email, name[, confirmed,
  avatar])`, `role_in(ws, user)`, `token_of(invitation)`, `remember_count` / `recall_count` and
  `remember_text` / `recall_text` (transaction-local `set_config` slots for delta assertions), the
  fixed ids (`alice`, `bob`, `ws_a`, `ws_b`, `carol` ... `grace`) and `assert_seed_invariants()`,
  which aborts the file with a clear message when the seed invariants below are broken. For the
  content model it adds the fixture ids `mod_a`, `mod_b`, `fld_a1` ... `fld_a6`, `fld_b1`,
  `rec_a1` ... `rec_a3`, `rec_b1` (all `...c0..`, distinct from the seed ids) and the helpers
  `create_module(id, ws, slug[, created_by])`, `create_field(id, module, key, type[, required,
  options, settings, position, ws])`, `create_record(id, module, title[, values, created_by, ws,
  status])` (all run as the current role, so they go through RLS while impersonating),
  `module_workspace(module)` and `values_of(record)` (security definer readers). For attachments
  (migration 005): `create_attachment(record, file_name[, uploaded_by, size, content_type, ws])`
  returns the generated id (clients cannot supply `id`; keep it with `remember_text`),
  `record_workspace(record)`, `path_of(attachment)`, `put_object(name[, metadata])` (inserts
  into `storage.objects` as the current role, as storage-api does after an upload),
  `object_meta(size[, mimetype])` and `allow_storage_delete()` (sets
  `storage.allow_delete_query`, which storage-api sets before every delete).
- Storage policies are tested in SQL, not over HTTP: impersonating `authenticated` and touching
  `storage.objects` directly is exactly what storage-api does, so the policies are exercised
  faithfully; no bytes are written. The HTTP path (upload, download, signed URL, 400 bodies) is
  checked by hand with the curl recipe in "Attachments bucket" below.
- Users are impersonated the way PostgREST does: `set local role authenticated` plus
  `set_config('request.jwt.claims', '{"sub": "<uuid>", "role": "authenticated"}', true)`. Extra
  users and memberships are inserted as `postgres` before impersonating.
- The only seed facts a test may assume are: workspaces A and B exist, alice owns A and is not a
  member of B, bob owns B and is not a member of A (`supabase/seed.sql`, `tests/fixtures/ids.ts`).
  Nothing else about the database is assumed, not even the seed module, fields and records of
  migration 004 (a manual session may have changed or deleted them). Therefore:
  - exact result sets are asserted on fixtures created inside the transaction (new users via
    `tests.create_user()`, new workspaces inserted as the owner so the triggers fire), never on
    seed totals;
  - "sees exactly X" on a seed user is written as "sees nothing outside the workspaces they belong
    to" (`is_empty('select ... except select workspace_id from workspace_members where user_id = ...')`)
    plus "sees X";
  - counts on seed workspaces are deltas against a count captured before the fixtures
    (`tests.remember_count` / `tests.recall_count`) or are restricted to rows written in the
    transaction with `created_at >= now()` (`now()` is frozen per transaction, so this selects
    exactly the test's own rows); "untouched" checks compare with a snapshot temp table;
  - destructive controls are scoped to ids (`delete ... where id = tests.ws_a()`), run last, and
    seed rows are never re-inserted.
- Fixture emails (`carol@example.com` ... `grace@example.com`, `invitee-a@example.com`, `c1@` ...)
  and fixed fixture ids must not be used by manual testing or by `dirty-state.sql`
  (`auth.users.email` is unique and `invitations_pending_unique` is per workspace and address).
- A failing test that exposes a schema bug is fixed with a new migration, never by editing an
  applied one or by weakening the assertion.

### Edge Functions

`npm run functions:serve` needs the stack running. It starts the Docker edge runtime (Deno 2; no
Deno install on the host is needed) and serves `invite-member`, `accept-invitation`,
`export-records` and `purge-attachments`, reloading on every file change. Stop it with Ctrl+C; the stack keeps running.

- Environment: the CLI injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` (plus the newer `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`)
  for the local stack; the hosted platform does the same in production. They are never written
  to a file. Function-specific variables live in `supabase/functions/.env` (git-ignored); copy
  `supabase/functions/.env.example`, which currently holds only `ALLOWED_ORIGIN`. In production
  set it with `supabase secrets set ALLOWED_ORIGIN=https://app.example.com`.
- Imports: one shared `supabase/functions/deno.json` (import map) for all functions;
  `config.toml` points each `[functions.<name>]` at it. Add dependencies there, never per
  function. `import_map.json` is deprecated in CLI 2.x.
- JWT: `verify_jwt = true` in `config.toml`, so the runtime answers a missing, malformed or expired
  token with its own 401 body before the function runs. Locally, Kong substitutes the anon key
  for a missing `Authorization` header, so that case reaches the function and gets the project's
  `{ error: { code: "unauthorized" } }` body instead. Clients treat any 401 as "sign in again".
- CORS: locally Kong's `cors` plugin answers `OPTIONS` for `/functions/v1/*` with `*` before the
  request reaches the runtime, so the functions' own preflight handler is only visible when the
  runtime is called directly (`http://supabase_edge_runtime_fleximanage:8081/<name>` from inside
  the Docker network). In production the function's headers apply; set `ALLOWED_ORIGIN`.
- Tooling: `supabase/functions/**` is excluded from ESLint and from the Vite `tsconfig` (Deno
  code with `npm:` specifiers); Prettier still formats it. Unit tests for the pure CSV helpers:
  `deno test supabase/functions/_shared/csv.test.ts`; without a local Deno, through Docker:
  `docker run --rm -v "$PWD/supabase/functions:/fns:ro" -w /fns denoland/deno:2.1.4 test --no-lock _shared/csv.test.ts`
  (on Git Bash prefix `MSYS_NO_PATHCONV=1`). Type-check like CI:
  `deno check --config supabase/functions/deno.json supabase/functions/*/index.ts`. Deploy with
  `supabase functions deploy <name>` once a hosted project exists (Phase 5).

Calling a function from a shell: obtain a JWT for a seed user with the password grant, then post
to the function. Set `ANON` from `npx supabase status -o env` (`ANON_KEY`).

```sh
curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'     # -> access_token
curl -s -X POST http://127.0.0.1:54321/functions/v1/invite-member \
  -H "apikey: $ANON" -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"workspaceId":"00000000-0000-0000-0000-0000000000aa","email":"bob@example.com","role":"member"}'
```

The invitation token is never returned by the API, is not selectable with a user JWT (column
grant, migration 003) and no email is sent yet (Phase 4 follow-up); for local testing read it
from the database as `postgres`
(`select token from public.invitations where email = 'bob@example.com' and accepted_at is null`)
and open `http://localhost:5173/invite/<token>` as the invitee. The dev server and
`npm run functions:serve` must both be running for the invite and accept flows.

Local ports: API `54321`, Postgres `54322`, Studio `54323`, mail `54324`. Connection string for
psql or `supabase db query`: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

For `npm run dev` against the local stack, set in `.env.local`:
`VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY=<anon key from supabase status>`.
The local anon key is a well-known demo key; the local service-role key still never goes in
`.env*` files.

Seed data (`supabase/seed.sql`, ids in `tests/fixtures/ids.ts`): `alice@example.com` owns
`workspace-a`, `bob@example.com` owns `workspace-b`, both with password `password123`. Since
migration 004 workspace A also has the module `clients` ("Clients") with the fields `company`
(text, required), `contact_email` (text), `status` (select lead/active/churned) and `value`
(currency EUR) and three records (Acme Ltd, Globex Corporation, Initech); workspace B has the
empty module `projects`. The seed is idempotent (`on conflict (id) do nothing`), so re-applying
it never duplicates content; the fixed ids are listed in `docs/architecture.md`, "Seed identities".
`site_url` and the redirect allow-list in `config.toml` point at the Vite dev server
(`http://localhost:5173`).

`supabase/.temp` and `supabase/.branches` are ignored by git. Migrations are forward-only: never
edit an applied file, add a new one and run `npm run db:reset`.

### End-to-end tests

Added 2026-11-04 (Part 15). Playwright 1.64, Chromium only, specs in `tests/e2e`, helpers in
`tests/e2e/support`, global setup and teardown in `tests/e2e/global-setup.ts`.

| Command                        | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `npm run test:e2e`             | All specs (smoke, journey, isolation, auth, validation; 33 tests).   |
| `npm run test:e2e:smoke`       | The unauthenticated smoke spec only; needs no stack.                 |
| `npm run test:e2e:ui`          | Playwright UI mode.                                                  |
| `npx playwright show-report`   | Open the last HTML report (`playwright-report/`, git-ignored).       |

Runtime requirements:

- The local stack running (`npm run db:start`) and `.env.local` pointing at it
  (`VITE_SUPABASE_URL=http://127.0.0.1:54321`). Authenticated specs only run when the URL is a
  local `http://127.0.0.1:<port>` or `http://localhost:<port>` address, so the suite cannot write to
  a hosted project by accident; otherwise they skip with a message.
- The app under test is the Vite dev server on `http://localhost:5173` (`webServer` runs
  `npm run dev -- --port 5173 --strictPort`; a running dev server is reused locally, never in CI).
  It must be `localhost`, not `127.0.0.1`: the Edge Functions answer CORS for
  `ALLOWED_ORIGIN=http://localhost:5173` only, and GoTrue's `site_url` is the same origin. The dev
  server (not `vite preview`) is needed because `isolation.spec.ts` imports
  `/src/lib/supabase.ts` in the page to call Storage with the signed-in user's own client.
- Edge Functions: the global setup posts to `/functions/v1/invite-member` without credentials and
  expects 401. Anything else (500 when the edge runtime container is stopped) makes it start
  `supabase functions serve` in the background (log in `test-results/functions-serve.log`), wait up
  to 120 s for the 401, and stop it (and the `supabase_edge_runtime_fleximanage` container) in
  teardown. A runtime that was already serving is left alone. The CLI recreates the runtime
  container on any file event in the served folder (about 5 s in which requests fail), so setup
  serves a snapshot copy of `supabase/config.toml` and `supabase/functions` from a temp directory
  (`--workdir`, removed in teardown): saving a function during a run cannot break the run, and the
  run tests the functions as they were when it started. Teardown warns if a reload happened anyway.
- Database access as `postgres` (`tests/e2e/support/db.ts`): `psql` with
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` when a `psql` client is on PATH (CI),
  otherwise `docker exec -i supabase_db_fleximanage psql -U postgres -d postgres -Atc ...` (local
  Windows without a Postgres client). `E2E_DB_MODE=psql|docker` and `E2E_DB_URL` override it.
  Used for invitation tokens (never returned by the API, no email yet), row counts and cleanup.
- Mailpit at `http://127.0.0.1:54324` (`E2E_MAILPIT_URL`): `auth.spec.ts` reads the
  password-reset link through `/api/v1/search` and `/api/v1/message/<id>`.

Conventions:

- Unique data per run: `playwright.config.ts` sets `E2E_RUN_ID` once in the main process (workers
  inherit it). Users are `e2e-<run id>-<spec>-<nonce>-<name>@example.com`; workspace, module and
  record names carry `<run id>-<nonce>`. The nonce is per worker, so a retried serial group (a new
  worker) never collides with the failed attempt. Nothing assumes an empty database; three runs in
  a row without `db:reset` pass.
- Seed users are used read-only, and only by `isolation.spec.ts` (alice and bob) and the
  teardown assertion. Every other spec signs up its own owner (through the UI in the journey,
  through `/auth/v1/signup` elsewhere) and works in its own workspace, so specs can run in
  parallel. The isolation spec adds one attachment to the seed record Acme Ltd in setup and
  removes it (object, then row) in teardown.
- Cleanup: each spec deletes its users with `delete from auth.users where email like
  '<prefix>%'` as `postgres` in `afterAll`. That is an account deletion: `on_auth_user_deleted`
  deletes the workspaces they owned alone, and modules, records, invitations and attachment rows
  cascade (objects are queued in `storage_deletion_queue`). The global teardown deletes any
  leftover `e2e-<run id>-%` user, calls `purge-attachments` with the local service-role key read
  from `supabase status -o env` in memory (never printed or written), and fails the run unless
  alice's only membership is owner of `workspace-a`, bob's only membership is owner of
  `workspace-b`, and Clients has exactly 3 records. The global setup removes `e2e-%@example.com`
  users older than three hours (aborted runs).
- Selectors go by role and label. Exceptions: `[data-field-key]` scopes a `definition` on the
  record detail page, and Storage is driven through the app's own client for the crafted-request
  checks. Files are picked through the "Choose files" button and the `filechooser` event, and
  downloads are read from the `download` event (byte equality, CSV BOM and lines).
- No fixed sleeps. Waiting is done with web-first assertions (`toHaveText`, `toHaveURL`,
  `toHaveAttribute`), `expect.poll` for Mailpit, and events (`download`, `filechooser`). "No
  request was sent" is asserted after the client-side errors have rendered, because the Zod and
  attachment checks run synchronously before any request would be made.
- Serial files (`journey`, `isolation`, `validation`) share pages created in `beforeAll`; a
  failure skips the rest of the file and a CI retry reruns the whole file with new data.
- Settings: `retries` 1 in CI and 0 locally, 2 workers in CI, trace on the first retry,
  screenshot on failure, reporters `list` and `html` (`playwright-report/`), locale `en-US`,
  timezone UTC.

Local timing on 2026-11-04 (Windows 11, Docker Desktop, default worker count): 96 to 106 s per run of
the 33 tests, including starting the dev server and `supabase functions serve`.

## Attachments bucket

Migration 005 creates the private Storage bucket `attachments` (10 MB per file, MIME allow-list
png, jpeg, gif, webp, pdf, plain text, csv, docx, xlsx, pptx, zip). Hosted projects get it from
the migration as well; nothing is configured in the dashboard. Objects live at
`<workspace_id>/<record_id>/<attachment_id>-<file_name>` and are reachable only through the
policies in `docs/architecture.md`, "Attachments". Locally the bytes are under
`/mnt/stub/stub/attachments/` in the `supabase_storage_fleximanage` container;
`npm run db:reset` empties `storage.objects` but not that directory (harmless; delete it with
`docker exec supabase_storage_fleximanage rm -rf /mnt/stub/stub/attachments` when needed).

Never delete from `storage.objects` in SQL: storage-api refuses it (`storage.protect_delete()`),
and forcing it leaves the file in the backend. Deleted attachment rows (direct or by cascade from
a record, module or workspace) are queued in `public.storage_deletion_queue` and removed by the
Edge Function `purge-attachments`.

Purge procedure (until the Phase 5 schedule exists; run after bulk deletes, and before a
workspace's data is reported as erased):

```sh
# SERVICE from `npx supabase status -o env` (SERVICE_ROLE_KEY) locally, or from the secret store;
# never echo it or put it in a file.
curl -s -X POST "$API_URL/functions/v1/purge-attachments" \
  -H "apikey: $ANON" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" \
  -d '{"limit":500}'                     # -> { "data": { "purged", "failed", "remaining" } }
```

Repeat while `remaining > 0`. Entries that failed 10 times are no longer retried; inspect them as
`postgres` with `select object_name, attempts, last_error from public.storage_deletion_queue where
attempts >= 10`, fix the cause and reset `attempts` to 0. Planned schedule (Phase 5): every 10
minutes, either pg_cron + pg_net (`net.http_post` with the key from Vault) or a GitHub Actions
cron with the key from repository secrets.

Manual HTTP check of an upload (alice, local stack): insert the row through PostgREST
(`POST /rest/v1/attachments` with `Prefer: return=representation` and `select=id,storage_path`),
then `POST /storage/v1/object/attachments/<storage_path, each segment URL-encoded>` with
`Content-Type` equal to the row's `content_type` and exactly `size_bytes` bytes; download with
`GET /storage/v1/object/authenticated/attachments/<path>`. Policy denials come back as HTTP 400
with `statusCode` 403 or 404 in the JSON body.

## CI

`.github/workflows/ci.yml` has three independent jobs on `ubuntu-latest`. Actions are pinned to major
versions (`actions/checkout@v4`, `actions/setup-node@v4`, `supabase/setup-cli@v1`), the npm cache
is enabled and concurrency cancels superseded runs on the same ref.

- `verify`: typecheck, lint, format check, unit tests and build.
- `db-tests`: installs the Supabase CLI pinned to `2.122.0` (same as the devDependency), runs
  `supabase start` (Docker is available on `ubuntu-latest`; a fresh start applies the migrations
  and `seed.sql`), then `supabase test db`, then regenerates the TypeScript types with
  `supabase gen types typescript --local` and fails on any diff against `src/types/supabase.ts`
  ("types drift"). Fix drift locally with `npm run db:types` and commit the result. The job also
  type-checks the Edge Functions with Deno 2 (`denoland/setup-deno@v2`,
  `deno check --config supabase/functions/deno.json supabase/functions/*/index.ts`) and runs
  `scripts/ci/functions-smoke.sh`, which reads the API URL and anon key from
  `supabase status -o env` (never printed), signs in as `alice@example.com` with the password
  grant and asserts status codes only: no credentials 401, invite into a foreign workspace 403,
  unknown invitation token 404, `export-records` into a foreign workspace 403, and
  `export-records` of the seed module Clients 200 with `text/csv` (each run writes one
  `records.exported` audit row in Workspace A). If the edge runtime is not answering it starts
  `supabase functions serve` itself and stops it afterwards. Run it locally with
  `bash scripts/ci/functions-smoke.sh` (needs curl, and jq or node).

- `e2e` (added 2026-11-04): only on pull requests into `main` and pushes to `main` (job-level
  `if`), 30-minute timeout. `npm ci`, Supabase CLI `2.122.0`, `supabase start`, then `.env.local`
  is written from `supabase status -o env` with the API URL and anon key only (masked, never
  echoed). Playwright browsers are cached in `~/.cache/ms-playwright` keyed by the
  `@playwright/test` version; `npx playwright install --with-deps chromium` still runs for the
  system packages. `npm run test:e2e` (`CI` is set: no server reuse, 1 retry, 2 workers); the
  global setup starts `supabase functions serve` if the edge runtime does not answer, like
  `scripts/ci/functions-smoke.sh`. On failure `playwright-report/` and `test-results/` are
  uploaded as the `playwright-report` artifact (7 days). `supabase stop --no-backup` always runs.
  Written and YAML-validated on 2026-11-04 (`npx -y js-yaml`); not yet run on GitHub.

## Free-tier notes

- GitHub Actions: free minutes for public repositories; private repositories have a monthly
  quota. The `verify` job runs in about 2 minutes; `db-tests` adds roughly 3 to 5 minutes, most of
  it pulling the Supabase Docker images.
- Supabase: the free tier pauses projects after inactivity. Move to a paid tier before Phase 6
  (pilots) and enable point-in-time recovery then.

## Backup and restore

Local: `npm run db:reset` rebuilds the database from migrations and seed; there is nothing to back
up. Hosted staging and production: not yet created. The procedure (dashboard backups,
`supabase db dump` for schema and data, restore rehearsal on staging) is written and rehearsed in
Phase 5.
