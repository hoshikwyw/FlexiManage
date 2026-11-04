# FlexiManage

Configurable management SaaS for small businesses. Each business gets an isolated workspace and
manages records through reusable modules, custom fields, forms and tables. The MVP targets one
workflow for one customer segment; see `docs/PLANNING.md` for phases, decisions and acceptance
criteria, and `CLAUDE.md` for the project rules every change must follow.

**Stack:** React 18 + Vite + TypeScript (strict), Tailwind CSS 4 + shadcn/ui, React Router,
TanStack Query, React Hook Form + Zod, Supabase (Auth, Postgres, Storage, Edge Functions),
Vitest + Testing Library, Playwright, GitHub Actions.

## Prerequisites

- Node.js 24 or later and npm 11 or later (`node -v`, `npm -v`).
- Git. Line endings are enforced as LF through `.gitattributes` (`* text=auto eol=lf`), so no
  `core.autocrlf` setting is needed on Windows; files are checked out and committed as LF.
- [Supabase CLI](https://supabase.com/docs/guides/local-development) for the `db:*` scripts
  (local database, migrations, type generation). Docker is required for `supabase start`.
- Playwright browsers for end-to-end tests: `npx playwright install --with-deps chromium`
  (not installed automatically).

## Setup

1. Clone the repository and install dependencies:
   ```sh
   npm ci
   ```
2. Start the local Supabase stack (Docker must be running) and create your environment file.
   `.env.local` is git-ignored; only the public URL and anon key belong in browser env files, the
   service-role key must never be added here.
   ```sh
   npm run db:start                 # first run pulls images and applies migrations + seed
   npx supabase status -o env       # prints API_URL and ANON_KEY (among others)
   cp .env.example .env.local       # then set:
   #   VITE_SUPABASE_URL=<API_URL, normally http://127.0.0.1:54321>
   #   VITE_SUPABASE_ANON_KEY=<ANON_KEY>
   ```
   For a hosted project use the URL and anon key from Project Settings > API instead.
3. Start the dev server and open <http://localhost:5173>. Sign in with a seed user
   (`alice@example.com` / `password123`) or create an account.
   ```sh
   npm run dev
   ```
   The local stack does not deliver email: confirmation and password-reset messages land in
   the Mailpit inbox at <http://127.0.0.1:54324> (the verify-email and forgot-password screens
   link to it in development). Locally `enable_confirmations = false`, so sign-up signs you in
   straight away.
4. Before opening a pull request, run the same checks CI runs:
   ```sh
   npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
   ```

## Using the app locally

Sign in as a seed user: `alice@example.com` owns Workspace A, `bob@example.com` owns Workspace B
(password `password123`). The sidebar switcher lists your workspaces and offers "Create
workspace"; a user without a workspace lands on `/workspaces/new`. Every workspace page lives
under `/w/<workspaceId>` (dashboard, `modules`, `members`, `settings`), so links can be shared with
co-members.

Modules: `/w/<id>/modules` lists what the workspace tracks (Workspace A ships with "Clients", four
fields and three records; Workspace B with an empty "Projects"). Owners and admins create a module
from a template ("Housekeeping tasks" or "Clients") or blank, then manage its fields on the module
page's Fields tab (add, edit label and required flag, reorder, delete) and rename or delete the
module under `/w/<id>/modules/<moduleId>/settings`. Every member works with records on the
Records tab (server-side search, per-field filters, sorting and pagination, all kept in the URL)
and creates, opens, edits and deletes them under `/w/<id>/modules/<moduleId>/records/...`. A record's page lists its attachments (any member uploads and downloads files of up to 10 MB, at most 10 per record), and owners and admins get "Export CSV" on the Records tab for the current search and filters (needs `npm run functions:serve` and the app opened on `http://localhost:5173`, the functions' CORS origin).

Invite flow: on `/w/<id>/members` an owner or admin invites by email and role; the invitation
appears under "Pending invitations" with a Revoke button. Email delivery is not wired up yet
(Phase 4 follow-up), so locally read the token from the database and open the link yourself:

```sh
docker exec -i supabase_db_fleximanage psql -U postgres -d postgres -Atc \
  "select token from public.invitations where email='bob@example.com' and accepted_at is null"
# then, signed in as the invitee (or sign in when prompted):
#   http://localhost:5173/invite/<token>
```

Edge Functions must be running for inviting and accepting (`npm run functions:serve`).

## Project layout

```
src/app          providers, router, layouts (AppLayout, AuthLayout), dashboard and 404 pages
src/features     auth, profile, workspaces, members, modules, records, billing (domain logic lives here)
src/components   ui (shadcn/ui), shared
src/lib          supabase client, utilities, validation
src/hooks        reusable hooks
src/types        including generated supabase.ts
supabase/        migrations, functions (Edge Functions), tests (RLS tests)
tests/           unit, e2e (Playwright), fixtures
docs/            PLANNING.md, operations.md and other documentation
.github/         CI workflows
```

Add shadcn/ui components with `npx shadcn@latest add <component>`; they land in `src/components/ui`.

## Scripts

| Script                     | Description                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Start the Vite dev server with hot module reload.                                                                                                  |
| `npm run build`            | Typecheck the app, then build the production bundle into `dist/`.                                                                                  |
| `npm run preview`          | Serve the production build locally.                                                                                                                |
| `npm run typecheck`        | Run `tsc -b` over every project in `tsconfig.json`: app (`src`, incl. co-located tests), node configs, `tests/`.                                   |
| `npm run lint`             | Run ESLint (flat config) over the whole repository.                                                                                                |
| `npm run format`           | Format all files with Prettier.                                                                                                                    |
| `npm run format:check`     | Verify formatting without writing (used in CI).                                                                                                    |
| `npm run test`             | Run unit and component tests once with Vitest (jsdom).                                                                                             |
| `npm run test:watch`       | Run Vitest in watch mode.                                                                                                                          |
| `npm run test:e2e`         | Run every Playwright spec in `tests/e2e` against the Vite dev server on `localhost:5173` (see End-to-end tests).                                   |
| `npm run test:e2e:smoke`   | Run only the unauthenticated smoke spec (works on a clean clone without a Supabase stack).                                                         |
| `npm run test:e2e:ui`      | Open Playwright UI mode for running and debugging specs interactively.                                                                             |
| `npm run test:db`          | Run the pgTAP database tests in `supabase/tests` against the local stack (passes on a fresh or a used database).                                   |
| `npm run test:db:fresh`    | `db:reset` then `test:db`: the CI-equivalent run against a freshly seeded database.                                                                |
| `npm run test:concurrency` | Race tests with two real database sessions (attachment cap, field delete, option removal, `update_record`) against the local stack.                |
| `npm run db:start`         | Start the local Supabase stack in Docker (`supabase start`).                                                                                       |
| `npm run db:dirty`         | Apply `scripts/db/dirty-state.sql` to the local database (extra users, workspaces, invitations, audit rows) to check `test:db` on a used database. |
| `npm run db:stop`          | Stop the local Supabase stack (`supabase stop`).                                                                                                   |
| `npm run db:reset`         | Reset the local Supabase database and re-apply migrations and seed.                                                                                |
| `npm run db:types`         | Generate TypeScript types from the local database into `src/types/supabase.ts`.                                                                    |
| `npm run functions:serve`  | Serve the Edge Functions in `supabase/functions` locally with hot reload (needs the stack running).                                                |

CI helper scripts live in `scripts/ci` and are plain bash (LF):

| Script                          | Description                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `scripts/ci/functions-smoke.sh` | Smoke-test the Edge Functions on the running local stack (401 / 403 / 404 status codes; needs `curl`, `jq`). |

## End-to-end tests

The Playwright suite in `tests/e2e` covers the primary journey and the key negative paths:

| Spec                 | What it proves                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `smoke.spec.ts`      | An unauthenticated visit redirects to sign-in. Needs no backend.                                                                                                                                                               |
| `journey.spec.ts`    | Sign up, create a workspace, apply "Housekeeping tasks", create, search, filter and edit records, upload and download a file, export CSV, invite a member who sees the records but not Export or the danger zone, remove them. |
| `isolation.spec.ts`  | Bob (Workspace B) gets "not found" for alice's workspace, module, record and members URLs, does not see Workspace A in the switcher, and cannot sign, download or upload Storage objects under Workspace A.                    |
| `auth.spec.ts`       | Sign-in validation and wrong password, redirect back after sign-in, sign-out, password reset through the Mailpit link.                                                                                                         |
| `validation.spec.ts` | Record form required errors without a request, server-side required error on a field added meanwhile, duplicate module slug, `.exe` and 11 MB attachments refused without a row.                                               |

Prerequisites for everything except the smoke spec:

1. Docker running and the local stack started: `npm run db:start` (migrations and seed applied).
2. `.env.local` pointing at it (`VITE_SUPABASE_URL=http://127.0.0.1:54321` and the anon key, see
   Setup). Authenticated specs skip themselves with a message when the URL is a placeholder or not a
   local address; the suite never runs against a hosted project.
3. Playwright Chromium: `npx playwright install --with-deps chromium`.

Then run `npm run test:e2e`. Playwright starts `npm run dev -- --port 5173 --strictPort` (or
reuses a dev server that is already running, locally only) and opens the app on
**`http://localhost:5173`**, never `127.0.0.1`: the Edge Functions' CORS allow-list contains that
origin only. The global setup checks that the stack answers and that the Edge Functions return 401
without credentials; if the edge runtime is not serving them it starts `supabase functions serve`
itself and stops it at the end. You do not need `npm run functions:serve` running, but it does no
harm.

The suite runs on a used database and leaves the seed intact: every user it creates is called
`e2e-<run id>-<spec>-...@example.com` and every workspace and module name carries the run id, so
runs never collide. Each spec deletes its users at the end (an account deletion, which removes the
workspaces they owned alone); the global teardown removes leftovers of the run, purges deleted
attachment objects through `purge-attachments`, and fails the run if alice no longer owns exactly
Workspace A, bob exactly Workspace B, or Clients no longer has three records. Invitation tokens are
read from the database and password-reset links from Mailpit (`http://127.0.0.1:54324`). Reports:
`playwright-report/` (HTML, git-ignored; `npx playwright show-report`) and `test-results/`
(screenshots on failure, traces on the first retry in CI). Conventions are in
`docs/operations.md`, "End-to-end tests".

## Local database

The database runs locally in Docker through the Supabase CLI (`supabase/config.toml`).

```sh
npm run db:start        # first run pulls images; prints API URL, anon key, Studio URL
npm run db:reset        # apply supabase/migrations and supabase/seed.sql from scratch
npm run db:types        # regenerate src/types/supabase.ts from the local schema
npm run test:db         # run the RLS / role / trigger tests in supabase/tests (pgTAP)
npm run test:db:fresh   # db:reset + test:db, what CI runs
npm run test:concurrency # two-session race tests (docs/operations.md, "Concurrency tests")
npm run db:stop         # stop the containers
```

The database tests (`supabase/tests/*.sql`) prove tenant isolation for every table in migration
001: each file runs in one transaction that is rolled back, impersonates the seeded users by
setting `role` and `request.jwt.claims` the way PostgREST does, and asserts the allow and deny
cases of `docs/architecture.md`'s policy matrix. New tables must ship with their own file.

Edge Functions (`supabase/functions`: `invite-member`, `accept-invitation`, shared toolkit in
`_shared/`) run in the Docker edge runtime with `npm run functions:serve`; no Deno install is
needed. Copy `supabase/functions/.env.example` to `supabase/functions/.env` for function-specific
variables (the Supabase URL and keys are injected by the CLI). Request and response shapes and
the error codes are documented in `docs/architecture.md`.

Point `.env.local` at the local stack with `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the
anon key printed by `npx supabase status`. Seed users: `alice@example.com` (owns `workspace-a`)
and `bob@example.com` (owns `workspace-b`), password `password123`; fixed ids live in
`tests/fixtures/ids.ts`. Schema, helper functions and the RLS policy matrix are documented in
`docs/architecture.md`; operator notes in `docs/operations.md`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: install, typecheck (all
`tsconfig` projects), lint, format check, unit tests and build on Node 24 with the npm cache
enabled (`verify`), and in parallel starts the local Supabase stack, type-checks the Edge
Functions with Deno (`deno check`), runs `scripts/ci/functions-smoke.sh` against the served
functions and `scripts/ci/purge-drain-check.sh`, checks the search tokenizer fixture under Deno,
runs the pgTAP tests and `npm run test:concurrency`, and fails if `src/types/supabase.ts` is out of date with the
migrations (`db-tests`). On pull requests into `main` and pushes to `main` the `e2e` job starts
the stack and runs `npm run test:e2e` with Chromium; on failure the HTML report and traces are
uploaded as the `playwright-report` artifact.
