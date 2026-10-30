# FlexiManage Project Plan

Living plan for the FlexiManage MVP. Source: FlexiManage React + Vite SaaS Plan (October 2026 edition).
Owner: project lead. Updated by the `product-planner` agent. Last updated: 2026-10-30.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[-]` dropped.

---

## 1. Vision and MVP statement

FlexiManage is a configurable management system for small businesses. Each business gets an isolated
workspace and manages records through reusable modules, custom fields, forms and tables.

**MVP statement:** one specific workflow, for one reachable customer segment, sold as a narrow paid pilot.
The visual drag-and-drop builder, automation, mobile apps, integrations and AI features are deferred until
paying customers ask for them.

**Success criteria for the MVP (by 2027-01-30):**
- At least 3 pilot workspaces created by real businesses, not by the team.
- At least 1 pilot customer has paid (any amount) for the pilot.
- Pilot users return and create records in at least 3 separate weeks.
- Zero cross-workspace data leaks in the security review and in production logs.

---

## 2. Open decisions (blockers before coding features)

| # | Decision | Options | Owner | Due | Status |
|---|----------|---------|-------|-----|--------|
| D1 | First customer segment and single workflow | Service offices (client and job tracking), small retail teams (inventory and supplier orders), accommodation operators (bookings and housekeeping) | Project lead | 2026-11-15 | [ ] |
| D2 | MVP data flexibility | Custom fields only, or custom fields plus user-created tables and relationships | Project lead + product-planner | 2026-11-22 | [ ] |
| D3 | Payment collection | Stripe, Paddle, Lemon Squeezy, or manual invoicing for pilots. Depends on business location and availability. | Project lead | 2026-11-22 | [ ] |
| D4 | Free-plan abuse controls | Email verification only, or verification plus rate limits, or invite-only free tier | product-planner + security-reviewer | 2026-12-06 | [ ] |
| D5 | Hosting provider for the SPA | Cloudflare Pages, Vercel, Netlify | devops-engineer | 2026-11-29 | [ ] |
| D6 | Workspace isolation acceptance criteria | Written as test cases in section 7 | test-engineer | 2026-11-29 | [ ] |

Recommendation for D2: custom fields only. User-created tables and relationships roughly double the schema,
RLS and UI work and are the first step toward the deferred visual builder.

---

## 3. Phases and milestones

Dates assume a start on Monday 2026-11-02 and follow the 90-day roadmap from the plan.

### Phase 0: Discovery (2026-11-02 to 2026-11-15) — Milestone M0: Niche chosen

- [ ] Pick a candidate segment and list 20 prospects (communities, referrals, public listings).
- [ ] Send personalised outreach to all 20 using the message template in section 9.
- [ ] Complete 5 to 10 conversations or asynchronous questionnaires.
- [ ] Collect at least 3 examples of current spreadsheets or manual processes.
- [ ] Write the top workflow as a one-page description with success criteria.
- [ ] Record decision D1 in the Decision Log.

Exit criteria: D1 decided; workflow description approved by the project lead.

### Phase 1: Prototype and specification (2026-11-16 to 2026-11-22) — Milestone M1: MVP spec frozen

- [ ] Clickable prototype of the primary journey (Figma or static HTML).
- [ ] Pricing test: show Free, Pro and Business tiers to 5 prospects; record reactions.
- [ ] Write user stories and acceptance criteria for the MVP (section 6).
- [ ] Record decisions D2 and D3.

Exit criteria: section 6 complete; prototype reviewed by at least 2 prospects.

### Phase 2: Foundation (2026-11-23 to 2026-12-06) — Milestone M2: Secure multi-tenant skeleton

Agents: devops-engineer, supabase-engineer, frontend-dev, test-engineer.

- [ ] Scaffold Vite + React + TypeScript strict, Tailwind, shadcn/ui, ESLint, Prettier (devops-engineer).
- [ ] Repository layout from section 5; `.env.example`; `README.md` with scripts (devops-engineer).
- [ ] GitHub Actions CI: typecheck, lint, unit tests, build (devops-engineer).
- [ ] Supabase project (local + staging), CLI config, type generation script (devops-engineer).
- [ ] Migration 001: `profiles`, `workspaces`, `workspace_members`, `invitations`, `audit_events` with RLS and membership helpers (supabase-engineer).
- [ ] Edge Function `create-workspace` that creates workspace, owner membership and audit event in one transaction (supabase-engineer).
- [ ] Edge Function `invite-member` with role check and audit event (supabase-engineer).
- [ ] Auth screens: sign up, log in, password reset, email verification handling (frontend-dev).
- [ ] Workspace create and switch; members list; invite flow (frontend-dev).
- [ ] App shell: sidebar layout, protected routes, workspace context (frontend-dev).
- [ ] Cross-workspace denial tests for every table in migration 001 (test-engineer).
- [ ] Role enforcement tests for invite and role change (test-engineer).
- [ ] Record decisions D5 and D6.

Exit criteria: a user can sign up, create a workspace, invite a second user; all isolation tests pass in CI.

### Phase 3: Core workflow (2026-12-07 to 2026-12-26) — Milestone M3: Usable product

Agents: supabase-engineer, frontend-dev, test-engineer, code-reviewer.

- [ ] Migration 002: `modules`, `field_definitions`, `records` (structured core + `custom_values jsonb`), `attachments` with RLS (supabase-engineer).
- [ ] Storage bucket `attachments` with path policy `{workspace_id}/{record_id}/{file}` (supabase-engineer).
- [ ] Full-text or trigram search on records scoped by workspace (supabase-engineer).
- [ ] Field-type registry: text, number, date, select, checkbox, currency (frontend-dev).
- [ ] Module settings page: define fields, order, required flag (frontend-dev).
- [ ] Records table with sorting, filters, pagination and search (frontend-dev).
- [ ] Record create and edit form generated from field definitions (frontend-dev).
- [ ] Attachment upload and download on a record (frontend-dev).
- [ ] CSV export via Edge Function `export-records` with audit event (supabase-engineer).
- [ ] Unit tests for field registry and Zod schema generation; component tests for form and table (test-engineer).
- [ ] Playwright primary journey (test-engineer).
- [ ] Code review of each feature before merge (code-reviewer).

Exit criteria: the chosen workflow from D1 can be completed end to end with real data from a prospect.

### Phase 4: Roles, quotas and billing scaffold (2026-12-27 to 2027-01-05) — Milestone M4: Plan limits enforced

Agents: supabase-engineer, frontend-dev, test-engineer.

- [ ] Migration 003: `plans`, `subscriptions`, `entitlements`, `usage_counters` seeded with Free, Pro, Business (supabase-engineer).
- [ ] Postgres function `check_entitlement(workspace_id, resource)` called from insert triggers on members, modules, records, attachments (supabase-engineer).
- [ ] Usage page showing counters against limits with over-limit state, no auto-deletion on downgrade (frontend-dev).
- [ ] Admin-only and owner-only UI gating matching server rules (frontend-dev).
- [ ] Billing provider integration per D3, or a manual "contact us" flow for pilots (supabase-engineer).
- [ ] Audit log page for owners (frontend-dev).
- [ ] Plan-limit tests and audit event tests (test-engineer).

Exit criteria: exceeding any Free limit fails server-side with a stable error code and the UI explains it.

### Phase 5: Hardening (2027-01-06 to 2027-01-15) — Milestone M5: Release candidate

Agents: security-reviewer, test-engineer, devops-engineer, frontend-dev.

- [ ] Full security review against the checklist in `.claude/agents/security-reviewer.md`; all Critical and High findings fixed.
- [ ] Accessibility pass: keyboard navigation, labels, contrast, focus management.
- [ ] Staging and production Supabase projects; environment separation verified.
- [ ] Backup and restore procedure written and rehearsed once (`docs/operations.md`).
- [ ] Account deletion and data export procedure documented.
- [ ] Error reporting and usage alerts configured.
- [ ] Rate limiting on signup, invitations and export.

Exit criteria: security review signed off; a restore from backup has been performed on staging.

### Phase 6: Pilot (2027-01-16 to 2027-01-30) — Milestone M6: Paying pilot customers

- [ ] Onboard 3 pilot workspaces with fixed scope, success criteria and a feedback date.
- [ ] Weekly check-in with each pilot; log usage and friction.
- [ ] Review pricing hypotheses against pilot feedback; update section 8.
- [ ] Decide what the next 90 days build based on observed usage, not the original wish list.

Exit criteria: MVP success criteria in section 1 evaluated and documented.

---

## 4. Architecture summary

- **Browser:** React SPA talks to Supabase Auth and to Postgres through the anon key, limited by Row Level Security.
- **Trusted path:** React SPA calls Edge Functions for privileged actions. Each function verifies the JWT, loads workspace role, checks entitlement, acts, writes an audit event.
- **Isolation:** every tenant-owned row carries `workspace_id`. Policies use shared helpers `is_workspace_member` and `has_workspace_role`. UI hiding is never the enforcement.
- **Future API:** domain rules live in plain TypeScript modules under each feature so a Node.js API can replace direct Supabase calls later.

### Data model

| Group | Tables | Notes |
|-------|--------|-------|
| Tenancy | `profiles`, `workspaces`, `workspace_members`, `invitations` | roles: owner, admin, member |
| Billing | `plans`, `subscriptions`, `entitlements`, `usage_counters` | limits enforced in DB functions |
| Content | `modules`, `field_definitions`, `records`, `attachments` | records: structured core plus `custom_values jsonb` |
| Observability | `audit_events` | written by Edge Functions and triggers |

---

## 5. Repository layout

```
src/
  app/          providers, router, layouts
  features/     auth, workspaces, members, modules, records, billing
  components/   ui (shadcn), shared
  lib/          supabase client, utilities, validation
  hooks/
  types/        including generated supabase.ts
supabase/
  migrations/   forward-only SQL
  functions/    Edge Functions
  tests/        RLS tests
  seed.sql
tests/
  unit/  e2e/  fixtures/
docs/
  PLANNING.md  architecture.md  security.md  operations.md  product/
.github/workflows/
.claude/agents/
.env.example
CLAUDE.md
```

---

## 6. MVP user stories and acceptance criteria

To be completed in Phase 1 once D1 is decided. Skeleton below; the product-planner agent fills it in.

### Epic A: Accounts and workspaces
- **A1** As a visitor I can sign up with email and password and verify my email.
- **A2** As a user I can create a workspace and become its owner.
- **A3** As an owner or admin I can invite a user by email with a role; the invitee joins on accepting.
- **A4** As a member I cannot see or act on any workspace I do not belong to.
  - Given a user in Workspace A, when they request any record, module, member or file of Workspace B by id or URL, then the response contains zero rows or a 403, and nothing is changed.

### Epic B: Modules and records (depends on D1 workflow)
- **B1** As an admin I can create a module and define its fields.
- **B2** As a member I can create, edit, view and delete records in a module.
- **B3** As a member I can search, filter, sort and page through records.
- **B4** As a member I can attach and download files on a record.
- **B5** As an admin I can export a module's records to CSV.

### Epic C: Plans and limits
- **C1** As an owner I can see current usage against my plan limits.
- **C2** When a limit is reached, creating the next item fails with a clear message, and no data is deleted.
- **C3** As an owner I can view the audit log of privileged actions.

---

## 7. Workspace isolation acceptance tests (decision D6)

Run with two seeded workspaces (A, B) and one user in each. Every tenant-owned table gets all four rows.

| Table | select B as A returns 0 | insert with B id fails | update B row as A affects 0 | delete B row as A affects 0 |
|-------|:-:|:-:|:-:|:-:|
| workspaces | [ ] | [ ] | [ ] | [ ] |
| workspace_members | [ ] | [ ] | [ ] | [ ] |
| invitations | [ ] | [ ] | [ ] | [ ] |
| modules | [ ] | [ ] | [ ] | [ ] |
| field_definitions | [ ] | [ ] | [ ] | [ ] |
| records | [ ] | [ ] | [ ] | [ ] |
| attachments (table and storage) | [ ] | [ ] | [ ] | [ ] |
| audit_events | [ ] | [ ] | [ ] | [ ] |
| subscriptions / entitlements / usage_counters | [ ] | [ ] | [ ] | [ ] |

Plus: Edge Functions `invite-member` and `export-records` return 403 when the caller is not a member of the target workspace, and 403 when the caller is a `member` for admin-only actions.

---

## 8. Pricing hypotheses (unvalidated)

| Plan | Price | Workspaces | Users | Modules | Records | Storage |
|------|-------|-----------:|------:|--------:|--------:|--------:|
| Free | $0 | 1 | 2 | 1 | 200 | 50 MB |
| Pro | $9/month | 1 | 5 | 5 | 5,000 | 1 GB |
| Business | $29/month | 3 | 20 | 20 | 50,000 | 10 GB |

Rules: enforce on the server; show usage transparently; never delete data on downgrade; consider a one-time
onboarding fee for early business pilots. Revisit after Phase 6.

Budget estimates (not quotes): prototype $0 to $5 per month; first paid customers $30 to $60 per month;
growing usage $80 to $300+ per month; domain $10 to $25 per year.

---

## 9. Customer discovery kit

**Outreach message**

> Hello! I am building a simple tool to reduce the time small teams spend managing [specific workflow].
> I am speaking with a few businesses to understand what currently takes the most time. Would you be open
> to answering 4 short questions by message? No sales call needed.

**Four questions**
1. Tell me about the last time you did [workflow]. What steps did it take?
2. What tools or spreadsheets do you use for it today?
3. Roughly how much time does it take per week, and who does it?
4. What happens when something goes wrong or gets missed?

**Pilot offer template**
Fixed scope (the one workflow), fixed price, 6-week duration, two success criteria agreed up front, feedback
call or form at week 3 and week 6, data export guaranteed at the end.

---

## 10. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Building the flexible platform before validating one workflow | Months of work with no customer | Phase 0 and 1 gate all feature work; product-planner guards scope |
| Cross-workspace leak via RLS mistake | Loss of trust, possible legal exposure | Shared policy helpers, per-table denial tests in CI, security review before M5 |
| Plan limits enforced only in UI | Revenue leakage, abuse | DB-level `check_entitlement` with tests |
| Free-tier abuse (spam signups, storage) | Cost and reputation | D4 decision, rate limits, email verification |
| Supabase free tier pauses or limits | Downtime for pilots | Move to paid tier before Phase 6; document in operations |
| Solo founder bandwidth | Schedule slip | Agents handle scaffolding, tests and reviews; cut scope before cutting tests |

---

## 11. Definition of done (every feature)

1. Acceptance criteria in section 6 met.
2. RLS policies and denial tests exist for any new table.
3. Unit or component tests for new logic; Playwright updated if the primary journey changed.
4. `npm run typecheck`, `npm run lint`, `npm run test` pass in CI.
5. code-reviewer pass with no Blockers; security-reviewer pass if a migration, policy or Edge Function changed.
6. Docs updated: `architecture.md` for schema or function changes, `operations.md` for runtime changes.

---

## 12. Agent usage map

| Need | Agent |
|------|-------|
| Scope, stories, roadmap, discovery material | product-planner |
| UI, routes, forms, tables, hooks | frontend-dev |
| Schema, RLS, Edge Functions, storage, seeds | supabase-engineer |
| Tests of any layer, isolation suites | test-engineer |
| Tooling, CI, environments, deploy, backups | devops-engineer |
| Review a diff for bugs and conventions | code-reviewer |
| Audit tenant isolation and secrets | security-reviewer |

---

## 13. Decision log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-30 | React + Vite + TypeScript SPA with Supabase backend; Next.js not used for the MVP | Authenticated dashboard needs no SEO; static hosting is cheap; Supabase removes early backend operations |
| 2026-10-30 | Privileged logic in Supabase Edge Functions; dedicated Node.js API deferred | Fewer services to run before product-market fit |
| 2026-10-30 | Seven project agents created under `.claude/agents/` | Parallelise scaffolding, tests and reviews for a small team |
