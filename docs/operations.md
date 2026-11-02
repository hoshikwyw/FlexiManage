# Operations

Runtime and tooling notes for operators. Updated by the `devops-engineer` and `supabase-engineer`
agents. Last updated: 2026-11-02 (Production prerequisites, migration 003).

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
- `npm run test:e2e` builds with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the
  environment or `.env*` files; without them `playwright.config.ts` injects placeholders so the
  unauthenticated smoke spec runs on a clean clone. Authenticated e2e needs `.env.local` pointing
  at the local stack.

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
| `npm run test:db`                   | `supabase test db`: run every `supabase/tests/*.sql` file with pgTAP (pg_prove in a container) against the local database. |
| `npx supabase migration new <name>` | Create an empty timestamped migration file.                                                                 |
| `npm run functions:serve`           | `supabase functions serve`: serve every folder in `supabase/functions` at `http://127.0.0.1:54321/functions/v1/<name>` with hot reload. See Edge Functions below. |
| `npm run db:stop`                   | `supabase stop`: stop the containers (data is kept in a Docker volume; `--no-backup` discards it).          |

### Database tests

`npm run test:db` needs the stack running (`npm run db:start`) and a database that matches the
migrations and seed (`npm run db:reset` after any schema or seed change). The CLI installs the
`pgtap` extension in the `extensions` schema if it is missing and runs `pg_prove` over
`supabase/tests` in file-name order. Conventions:

- Files are numbered (`01_rls_enabled.sql` ... `12_review_fixes.sql`) and each wraps everything in
  `begin; select plan(N); ... select * from finish(); rollback;`, so a run leaves no data behind.
- Users are impersonated the way PostgREST does: `set local role authenticated` plus
  `set_config('request.jwt.claims', '{"sub": "<uuid>", "role": "authenticated"}', true)`. Each file
  defines the small `tests.login_as(uuid)`, `tests.logout()` and `tests.rows_affected(sql)` helpers
  inside its transaction. Extra users and memberships are inserted as `postgres` before
  impersonating.
- Fixed ids come from `supabase/seed.sql` / `tests/fixtures/ids.ts` (alice owns A, bob owns B).
- A failing test that exposes a schema bug is fixed with a new migration, never by editing an
  applied one or by weakening the assertion.

### Edge Functions

`npm run functions:serve` needs the stack running. It starts the Docker edge runtime (Deno 2; no
Deno install on the host is needed) and serves `invite-member` and `accept-invitation`, reloading
on every file change. Stop it with Ctrl+C; the stack keeps running.

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
  code with `npm:` specifiers); Prettier still formats it. Deploy with
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
`workspace-a`, `bob@example.com` owns `workspace-b`, both with password `password123`.
`site_url` and the redirect allow-list in `config.toml` point at the Vite dev server
(`http://localhost:5173`).

`supabase/.temp` and `supabase/.branches` are ignored by git. Migrations are forward-only: never
edit an applied file, add a new one and run `npm run db:reset`.

## CI

`.github/workflows/ci.yml` has two independent jobs on `ubuntu-latest`. Actions are pinned to major
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
  unknown invitation token 404. If the edge runtime is not answering it starts
  `supabase functions serve` itself and stops it afterwards. Run it locally with
  `bash scripts/ci/functions-smoke.sh` (needs curl, and jq or node).

Planned: an `e2e` job on pull requests to `main` with Playwright browsers cached.

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
