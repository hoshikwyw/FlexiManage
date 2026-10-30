# FlexiManage

Configurable management SaaS for small businesses. Each business has an isolated workspace with modules,
custom fields, records, forms and tables. MVP targets one workflow for one customer segment.

## Read first
- `docs/PLANNING.md` for phases, milestones, open decisions and acceptance criteria.
- `.claude/agents/` for the specialised agents and the rules each one enforces.

## Stack
React 18 + Vite + TypeScript (strict) · Tailwind CSS + shadcn/ui · React Router · TanStack Query ·
React Hook Form + Zod · Supabase (Auth, Postgres, Storage, Edge Functions) · Vitest + Testing Library ·
Playwright · GitHub Actions · static hosting.

## Project rules
1. Every tenant-owned table has `workspace_id` and Row Level Security with per-command policies built on the
   shared helpers `is_workspace_member` and `has_workspace_role`.
2. Authorization and plan limits are enforced in Postgres or Edge Functions. The UI only hides controls.
3. The service-role key and payment secrets never reach browser code, `.env.example`, or docs.
4. Privileged actions (invite, role change, plan change, export, delete workspace) go through Edge Functions
   and write an `audit_events` row.
5. Server state lives in TanStack Query with query keys scoped by `workspaceId`.
6. Forms are Zod schema first. Custom field values render through the field-type registry.
7. Domain rules live in plain TypeScript modules under `src/features/*`, not inside React components.
8. Migrations are forward-only. Every new table ships with cross-workspace denial tests.
9. Downgrades never delete data.
10. Absolute dates in docs (2026-11-23), never relative ones.

## Layout
```
src/app  src/features  src/components  src/lib  src/hooks  src/types
supabase/migrations  supabase/functions  supabase/tests  supabase/seed.sql
tests/unit  tests/e2e  tests/fixtures
docs/  .github/workflows/  .claude/agents/
```

## Scripts (once scaffolded)
`npm run dev` · `build` · `typecheck` · `lint` · `test` · `test:e2e` · `db:reset` · `db:types`

## Agents
product-planner · frontend-dev · supabase-engineer · test-engineer · devops-engineer · code-reviewer ·
security-reviewer. See `docs/PLANNING.md` section 12 for when to use each.
