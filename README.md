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
- Git.
- [Supabase CLI](https://supabase.com/docs/guides/local-development) for the `db:*` scripts
  (local database, migrations, type generation). Docker is required for `supabase start`.
- Playwright browsers for end-to-end tests: `npx playwright install --with-deps chromium`
  (not installed automatically).

## Setup

1. Clone the repository and install dependencies:
   ```sh
   npm ci
   ```
2. Create your local environment file and fill in the values from your Supabase project
   (Project Settings > API). Only the public URL and anon key belong in browser env files;
   the service-role key must never be added here.
   ```sh
   cp .env.example .env.local
   ```
3. Start the dev server:
   ```sh
   npm run dev
   ```
4. Before opening a pull request, run the same checks CI runs:
   ```sh
   npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
   ```

## Project layout

```
src/app          providers, router, layouts
src/features     auth, workspaces, members, modules, records, billing (domain logic lives here)
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

| Script                 | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server with hot module reload.                               |
| `npm run build`        | Typecheck the app, then build the production bundle into `dist/`.               |
| `npm run preview`      | Serve the production build locally.                                             |
| `npm run typecheck`    | Run `tsc --noEmit` against `tsconfig.app.json`.                                 |
| `npm run lint`         | Run ESLint (flat config) over the whole repository.                             |
| `npm run format`       | Format all files with Prettier.                                                 |
| `npm run format:check` | Verify formatting without writing (used in CI).                                 |
| `npm run test`         | Run unit and component tests once with Vitest (jsdom).                          |
| `npm run test:watch`   | Run Vitest in watch mode.                                                       |
| `npm run test:e2e`     | Run Playwright end-to-end tests in `tests/e2e` (builds and previews first).     |
| `npm run db:reset`     | Reset the local Supabase database and re-apply migrations and seed.             |
| `npm run db:types`     | Generate TypeScript types from the local database into `src/types/supabase.ts`. |

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: install, typecheck, lint, format
check, unit tests and build on Node 24 with the npm cache enabled. Database tests and Playwright
jobs are added when the Supabase stack is configured (Phase 2).
