# Operations

Runtime and tooling notes for operators. Updated by the `devops-engineer` agent.
Last updated: 2026-10-30.

## Environments

| Environment | Where                              | Env file               | Notes                                             |
| ----------- | ---------------------------------- | ---------------------- | ------------------------------------------------- |
| Local       | `npm run dev` + local Supabase CLI | `.env.local` (ignored) | Copy from `.env.example`. Supabase CLI in Part 2. |
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
- Prettier enforces LF line endings. On Windows, set `git config core.autocrlf false` for this
  repository so `npm run format:check` matches CI.

## CI

`.github/workflows/ci.yml`: one `verify` job on `ubuntu-latest` running typecheck, lint, format
check, unit tests and build. Actions pinned to major versions (`actions/checkout@v4`,
`actions/setup-node@v4`), npm cache enabled, concurrency cancels superseded runs on the same ref.

Planned (Part 2 / Phase 2): a `db-tests` job that starts the local Supabase stack and runs the RLS
denial tests, and an `e2e` job on pull requests to `main` with Playwright browsers cached.

## Free-tier notes

- GitHub Actions: free minutes for public repositories; private repositories have a monthly
  quota. The `verify` job runs in about 2 minutes.
- Supabase: the free tier pauses projects after inactivity. Move to a paid tier before Phase 6
  (pilots) and enable point-in-time recovery then.

## Backup and restore

Not yet applicable (no database). To be written with the Supabase CLI setup in Part 2 and
rehearsed in Phase 5.
