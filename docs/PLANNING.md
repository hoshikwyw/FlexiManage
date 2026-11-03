# FlexiManage Project Plan

Living plan for the FlexiManage MVP. Source: FlexiManage React + Vite SaaS Plan (October 2026 edition).
Owner: project lead. Updated by the `product-planner` agent. Last updated: 2026-11-03.

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

Recommendation for D1 (prepared 2026-11-03, not the decision): accommodation operators with 3 to 20
rooms, workflow "housekeeping turnover tracking", default module "Housekeeping tasks". Scoring and
fallback in `docs/product/segment-comparison.md`; outreach, script and pilot offer in
`docs/product/discovery-kit.md`.

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
- [x] Recommendation prepared 2026-11-03: see `docs/product/segment-comparison.md`; D1 decision still owned by the project lead, due 2026-11-15.

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
- [-] Edge Function `create-workspace` that creates workspace, owner membership and audit event in one transaction (supabase-engineer). Deferred to Phase 4: the `on_workspace_created` trigger from migration 001 already does this atomically; the function is only needed once plan limits must be checked before the insert.
- [x] Edge Function `invite-member` with role check and audit event (supabase-engineer). Done 2026-10-30 together with `accept-invitation`, the shared toolkit in `supabase/functions/_shared` and migration 002 (`accept_invitation()` SQL function, tested in `supabase/tests/11_accept_invitation_fn.sql`).
- [x] Auth screens: sign up, log in, password reset, email verification handling (frontend-dev). Done 2026-10-30: `src/features/auth` (PKCE callback, verify-email with resend, friendly error mapping), see `docs/architecture.md`, Frontend.
- [x] Workspace create and switch; members list; invite flow (frontend-dev). Done 2026-10-30: `src/features/workspaces` (switcher, create dialog and first-run page, settings and danger zone, `WorkspaceProvider`, workspace-scoped routes `/w/:workspaceId/...`) and `src/features/members` (members table with role/remove/leave actions, invite form calling `invite-member`, pending invitations with revoke, `/invite/:token` acceptance page); dashboard shows the workspace list and recent audit events. See `docs/architecture.md`, Frontend.
- [x] App shell: sidebar layout, protected routes, workspace context (frontend-dev). Done 2026-10-30: `AppLayout` (responsive sidebar, user menu), `ProtectedRoute`/`PublicOnlyRoute`, dashboard and profile settings; the workspace context (`WorkspaceProvider`) landed with the item above.
- [x] Cross-workspace denial tests for every table in migration 001 (test-engineer). `supabase/tests/02`–`06`, 2026-10-30.
- [x] Role enforcement tests for invite and role change (test-engineer). `supabase/tests/07_roles.sql`, `08_last_owner.sql`, 2026-10-30.
- [ ] Record decisions D5 and D6.

Exit criteria: a user can sign up, create a workspace, invite a second user; all isolation tests pass in CI.
Met 2026-10-30: verified end to end against the local stack (sign up, create "Pilot Co", invite
bob@example.com, accept through `/invite/:token`, leave, delete); `supabase test db` passes in the
`db-tests` CI job. Open items D5/D6 are documentation only and do not block M2.

Review round 1 (2026-10-30, fixed 2026-11-02): migration
`supabase/migrations/20261102090000_003_review_fixes.sql` plus `supabase/tests/12_review_fixes.sql`
(suite now 12 files, 380 tests) and an `invite-member` change. Fixed: (1) `invitations` insert
limited to `workspace_id, email, role, invited_by`, email format check, one pending invitation per
workspace and address (`invite-member` deletes expired rows first and treats `23505` as the
idempotent case); (2) `invitations.token` hidden from API clients (column-level select grant);
(3) direct inserts into `workspace_members` removed for every role, acceptance is the only path
(product decision); (4) last-owner guard serialised with a per-workspace advisory lock;
(5) account deletion: a `before delete on auth.users` trigger promotes the earliest-joined admin,
else earliest member, else deletes the workspace, and the guard lets the cascade through;
(6) `profiles.email` follows `auth.users.email`, `full_name` truncated to 100 at signup;
(7) named check constraints on `profiles.full_name` and `profiles.avatar_url`; (8) invitation
audit metadata carries `invitation_id` and `role`, never the invitee email (product decision).
Details in `docs/architecture.md` ("Review fixes", "Account deletion") and
`docs/operations.md` ("Production prerequisites").

Follow-ups from Phase 2 (scheduled in Phase 4 unless noted):
- Invitation email delivery (provider + template): `invite-member` creates the row and the audit
  event but no email is sent yet; locally the token is read from the database
  (`docs/operations.md`). The members page states that email delivery is not set up yet.
- [x] Code-splitting (done 2026-11-02): route pages are lazy-loaded; the main chunk dropped from
  908 kB to 272 kB.
- PostgREST embedding for `workspace_members.user_id` and `audit_events.actor_id`: both reference
  `auth.users`, so the UI loads profiles in a second query. A migration adding
  `references public.profiles` (or a view) would allow a single embedded select (supabase-engineer).

### Phase 3: Core workflow (2026-12-07 to 2026-12-26) — Milestone M3: Usable product

Agents: supabase-engineer, frontend-dev, test-engineer, code-reviewer.

- [x] Migration 004 (done 2026-11-03): `modules`, `field_definitions`, `records` (structured core + `custom_values jsonb`) with RLS, validation and audit (supabase-engineer). `attachments` moves to the storage migration below.
- [ ] Storage bucket `attachments` with path policy `{workspace_id}/{record_id}/{file}` (supabase-engineer).
- [x] (done 2026-11-03) Full-text and trigram search on records scoped by workspace (supabase-engineer).
- [x] (done 2026-11-04) Field-type registry: text, number, date, select, checkbox, currency (frontend-dev). `src/features/records/fields/` with `buildRecordSchema` for Part 12.
- [x] (done 2026-11-04) Module settings page: define fields, order, required flag (frontend-dev). Modules list, create dialog, module page (Records placeholder + Fields tab), settings page with danger zone.
- [ ] Records table with sorting, filters, pagination and search (frontend-dev).
- [ ] Record create and edit form generated from field definitions (frontend-dev).
- [ ] Attachment upload and download on a record (frontend-dev).
- [ ] CSV export via Edge Function `export-records` with audit event (supabase-engineer).
- [x] (done 2026-11-04, frontend part) Module templates (added 2026-11-03, Epic B6): templates shipped as code under `src/features/modules/lib/templates.ts` ("Blank", "Housekeeping tasks" = D1 default, "Clients"); "start from a template" on an empty modules list and in "New module". Open for supabase-engineer: the create is sequential (module insert, then field inserts, best-effort delete on failure), not one transaction; a `create_module_with_fields` SQL function or Edge Function can replace `applyTemplate`'s writer without touching the UI.
- [ ] Unit tests for field registry and Zod schema generation; component tests for form and table (test-engineer).
- [ ] Playwright primary journey (test-engineer).
- [ ] Code review of each feature before merge (code-reviewer).

Exit criteria: the chosen workflow from D1 can be completed end to end with real data from a prospect.

### Phase 4: Roles, quotas and billing scaffold (2026-12-27 to 2027-01-05) — Milestone M4: Plan limits enforced

Agents: supabase-engineer, frontend-dev, test-engineer.

- [ ] Migration 005: `plans`, `subscriptions`, `entitlements`, `usage_counters` seeded with Free, Pro, Business (supabase-engineer).
- [ ] Postgres function `check_entitlement(workspace_id, resource)` called from insert triggers on members, modules, records, attachments (supabase-engineer).
- [ ] Usage page showing counters against limits with over-limit state, no auto-deletion on downgrade (frontend-dev).
- [ ] Admin-only and owner-only UI gating matching server rules (frontend-dev).
- [ ] Billing provider integration per D3, or a manual "contact us" flow for pilots (supabase-engineer).
- [ ] Audit log page for owners (frontend-dev).
- [ ] Plan-limit tests and audit event tests (test-engineer).
- [ ] Platform admin web (added 2026-11-03): operator back-office for the FlexiManage team, separate
  from workspace admin. Minimal scope: `platform_admins` table and `is_platform_admin()` helper;
  read policies for platform admins on `workspaces`, `workspace_members`, `subscriptions`,
  `usage_counters` and `audit_events` across tenants; admin-only Edge Functions for change plan,
  suspend workspace and support impersonation (every call audited); an `/admin` route group in the
  app guarded by the platform role (workspace list with usage vs limits, subscription view,
  cross-tenant audit log). Until it exists, Supabase Studio / the Supabase dashboard is the
  operator console (supabase-engineer, frontend-dev, security-reviewer).

Exit criteria: exceeding any Free limit fails server-side with a stable error code and the UI explains it.

### Phase 5: Hardening (2027-01-06 to 2027-01-15) — Milestone M5: Release candidate

Agents: security-reviewer, test-engineer, devops-engineer, frontend-dev.

- [ ] Full security review against the checklist in `.claude/agents/security-reviewer.md`; all Critical and High findings fixed.
- [ ] Accessibility pass: keyboard navigation, labels, contrast, focus management.
- [ ] Staging and production Supabase projects; environment separation verified.
- [ ] GoTrue `enable_confirmations = true` and `double_confirm_changes = true` verified on staging and production (`docs/operations.md`, "Production prerequisites"): `accept_invitation()` relies on `email_confirmed_at`. Blocking for M5.
- [ ] Backup and restore procedure written and rehearsed once (`docs/operations.md`).
- [ ] Account deletion and data export procedure documented. Database side done in migration 003 (`docs/architecture.md`, "Account deletion"); the self-service Edge Function, UI copy and export remain.
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

Skeleton written 2026-10-30; Epic B filled in 2026-11-03 (segment-agnostic, only the B6 template
depends on D1). Epics A and C are completed in Phase 1 by the product-planner agent.

### Epic A: Accounts and workspaces
- **A1** As a visitor I can sign up with email and password and verify my email.
- **A2** As a user I can create a workspace and become its owner.
- **A3** As an owner or admin I can invite a user by email with a role; the invitee joins on accepting.
- **A4** As a member I cannot see or act on any workspace I do not belong to.
  - Given a user in Workspace A, when they request any record, module, member or file of Workspace B by id or URL, then the response contains zero rows or a 403, and nothing is changed.

### Epic B: Modules and records

Written 2026-11-03. The stories describe a generic records workflow that works for any D1 segment;
the segment only changes the template seeded in B6. Conventions that apply to every story:

- **Roles.** Defining modules and fields (B1, B6) and exporting (B5) are owner/admin actions.
  Working with records and attachments (B2 to B4) is open to every role, including `member`.
  Per-record ownership ("only the author may edit") is deferred.
- **Field types.** Exactly six: `text`, `number`, `date`, `select`, `checkbox`, `currency`. No
  relation, lookup, user, file, formula or multi-select type (see the scope note after B6).
- **Workspace isolation.** `modules`, `field_definitions`, `records` and `attachments` carry
  `workspace_id` and get one policy per command built on `is_workspace_member` /
  `has_workspace_role`, plus the four denial tests in section 7 (test-engineer). Storage object
  paths start with `{workspace_id}/`. TanStack Query keys start with `workspaceId`. Unknown ids in
  another workspace behave exactly like non-existent ids (zero rows or 403), never 404 with detail.
- **Plan limits.** Phase 4 meters `modules` (per workspace), `records` (per workspace across all
  modules), `storage_bytes` and `attachments` (per workspace) and `members`. Phase 3 does not enforce
  them, but every creation in this epic goes through exactly one insert path (a table insert, one
  SQL function or one Edge Function) so `check_entitlement` can be attached in migration 005 without
  changing the UI. Field definitions and select options are not metered by plan; they get fixed
  caps (hypothesis: 50 fields per module, 30 options per select field) enforced in the database.
  Every quota figure in this epic is a hypothesis until Phase 6.
- **Routes (proposal for frontend-dev, extends the route map in `docs/architecture.md`).**
  `/w/:workspaceId/modules/new`, `/w/:workspaceId/modules/:moduleId` (records table),
  `/w/:workspaceId/modules/:moduleId/settings` (fields), `/w/:workspaceId/modules/:moduleId/records/new`,
  `/w/:workspaceId/modules/:moduleId/records/:recordId`.
- **Agents.** Schema, policies, SQL functions, storage and `export-records`: supabase-engineer.
  Field-type registry, Zod generation, pages: frontend-dev. Denial tests, unit and component tests,
  Playwright journey: test-engineer. No code is written in this document.

#### B1 Create a module and define its fields

As an owner or admin I can create a module with a name and define its fields (label, type, required
flag, order, select options) so my team records exactly the data our workflow needs.

Acceptance criteria
- Given I am an owner or admin of workspace A, when I create a module named "Housekeeping tasks",
  then the module exists in A with my user as creator, appears in A's sidebar, and the empty records
  page for it opens.
- Given I am a `member` of A, when I try to create, rename or delete a module or change its fields
  through the UI or a direct API call, then the UI shows no such controls and the database denies
  the command (zero rows affected or a policy error).
- Given a module, when I add a field, then I must enter a label (1 to 60 characters) and pick one of
  the six MVP types; the required flag defaults to off; the field receives the next position; a
  stable key is generated from the label, is unique within the module and never changes afterwards.
- Given a `select` field, when I define its options, then I must enter 1 to 30 (hypothesis) distinct
  non-empty labels with an order; renaming an option keeps existing records valid (they store the
  option key, not the label); removing an option keeps the stored value on existing records, shows it
  as "(removed option)" in forms and tables, and the next save of such a record requires a current
  option when the field is required.
- Given several fields, when I drag or move one to a new position, then the order is persisted and
  used identically by the record form (B2), the records table (B3) and the CSV export (B5).
- Given a field with records, when I try to change its type, then the UI does not offer it and the
  database rejects it; the documented path is to delete the field and create a new one.
- Given I delete a field, then it disappears from forms, tables, filters and exports; values already
  stored under its key remain in `custom_values` but are ignored (no data destruction, rule 9).
- Given I add a required field to a module that already has records, then existing records remain
  readable and listable; the requirement is enforced on their next edit.
- Given a module name, when I save, then names are unique per workspace (case-insensitive, trimmed)
  and a duplicate shows a field-level error.
- Given a module with records, when I delete it, then I must type its name to confirm; the module,
  its field definitions, records and attachments (rows and storage objects) are removed and a
  `module.deleted` audit event with `{ name, record_count }` is written. Because storage objects
  must be removed as well, deletion runs through one trusted path (Edge Function or SQL function
  plus storage cleanup; supabase-engineer decides and documents it in `docs/architecture.md`).
- Given a module already has 50 fields (hypothesis cap), when I add another, then the database
  rejects it with a stable error code and the UI explains the cap.

Workspace isolation: `modules` and `field_definitions` carry `workspace_id`; select requires
`is_workspace_member`, insert/update/delete require `has_workspace_role(owner, admin)`; a
`field_definitions` row must reference a module in the same workspace (enforced by constraint or
trigger, tested). Module names are unique per workspace, not globally, so a name collision never
reveals another tenant's modules.

Plan limits: each module counts 1 toward `modules` (Free hypothesis: 1, Pro 5, Business 20).
Field definitions and options are capped, not metered. Deleting a module decrements `modules` and
`records` counters by the deleted amounts in Phase 4.

#### B2 Create, view, edit and delete records with validated custom values

As a member I can create, view, edit and delete records in a module through a form generated from
its field definitions, and every value is validated against those definitions on the server.

Acceptance criteria
- Given a module with fields, when I open "New record", then the form shows one input per field in
  module order using the field-type registry (text input, number input, date picker, select,
  checkbox, currency input with two decimals), marks required fields, and validates with a Zod schema
  generated from the same definitions before submitting.
- Given I submit a record, when the server receives `custom_values`, then it rejects unknown keys,
  values of the wrong type (number and currency: finite decimal, currency with at most 2 fraction
  digits; date: `YYYY-MM-DD`; select: a current option key; checkbox: boolean; text: string of at
  most 2,000 characters, hypothesis) and missing required values, with a stable error code and the
  offending field key; the UI maps it to a field-level error. Validation runs in Postgres so direct
  API calls cannot bypass it (rule 2). The exact storage representation of currency is chosen by
  supabase-engineer and documented in `docs/architecture.md`.
- Given a saved record, when I open it, then I see every field in order with type-appropriate
  formatting, plus created by, created at and updated at.
- Given a saved record, when I edit it and save, then only changed values are validated and written,
  `updated_at` changes, and the detail view and table refresh (query invalidation scoped by
  workspace and module). Concurrent edits are last-write-wins in the MVP.
- Given a record, when I delete it, then I confirm once, the record and its attachment rows are
  removed, the storage objects under its prefix are deleted by the same path, and the table refreshes.
  Record deletion is not written to `audit_events` in the MVP (high volume, readable by all members);
  soft delete and a trash view are deferred.
- Given the first field of the module (by order), then its value is the record's label in lists,
  breadcrumbs and attachment dialogs; if it is empty, the label falls back to a short id.
- Given a module with no fields, when a member opens "New record", then the form explains that an
  admin must define fields first and shows no submit button.

Workspace isolation: `records` carry `workspace_id` and `module_id`; all four commands require
`is_workspace_member(workspace_id)`; a record's module must belong to the same workspace (constraint
or trigger, tested). A user of workspace A requesting a record id from workspace B receives zero
rows, including through the detail route, which then shows the generic not-found page.

Plan limits: each record counts 1 toward `records` across all modules of the workspace (Free
hypothesis: 200, Pro 5,000, Business 50,000). Deleting decrements. Over the limit, reads, edits and
deletes keep working; only creation fails (rule 9, Epic C2).

#### B3 Search, filter, sort and paginate records

As a member I can find records quickly in a module with search, per-field filters, sorting and
pagination, all executed on the server and scoped to my workspace.

Acceptance criteria
- Given a module with more than 25 records, when I open it, then I see 25 rows (page size options 25,
  50, 100), a "x to y of N" indicator and next/previous controls; paging, sort and filters are stored
  in the URL search parameters so a view can be shared with another member of the same workspace.
- Given the table, when I click a column header, then rows sort by that field server-side with
  type-aware ordering (text and select alphabetically by label, number and currency numerically, date
  chronologically, checkbox false before true) and `created_at` / `updated_at` are sortable too;
  default sort is `updated_at` descending.
- Given a field type, when I add a filter, then I get: text contains (case-insensitive); number,
  currency and date between min and max (either side optional); select one or more options; checkbox
  true or false. Multiple filters combine with AND; the active filter count is shown and all can be
  cleared at once.
- Given a search box, when I type at least 2 characters, then results match text and select values
  across all fields of the module (trigram or full-text index on `records`, scoped by workspace and
  module), debounced, combined with active filters; for 5,000 records (Pro hypothesis) the first page
  returns within 1 second on the local stack.
- Given filters that match nothing, then the table shows an explicit empty state with a "clear
  filters" action, distinct from the "no records yet" empty state.
- Given a user who is not a member of the workspace, when they call the same list, count or search
  query with that workspace id, then both the rows and the count are zero.

Workspace isolation: list, count and search queries are all plain selects on `records` under RLS;
no view, RPC or index bypasses it. If search is implemented as a SQL function, it is `security
invoker` so the policies still apply. Saved views, cross-module search and sharing links outside
the workspace are deferred.

Plan limits: none consumed. Page size is capped at 100 server-side so a client cannot pull a whole
module in one request; bulk access is the export in B5.

#### B4 Attach and download files on a record

As a member I can attach files to a record and download them, and no file is reachable from
another workspace.

Acceptance criteria
- Given a record, when I upload a file, then the client first inserts an `attachments` row
  (`workspace_id`, `record_id`, file name, size, MIME type, uploader) and only then uploads to the
  `attachments` bucket at `{workspace_id}/{record_id}/{attachment_id}-{sanitised file name}`; if the
  upload fails the row is removed; if the row insert fails nothing is uploaded. This ordering gives
  Phase 4 a single insert to attach `check_entitlement` to.
- Given a file over 10 MB (hypothesis), or a MIME type outside the allow list (hypothesis: pdf, png,
  jpg, jpeg, webp, heic, csv, xlsx, docx), or an 11th file on one record (hypothesis cap 10), then the
  upload is refused by the bucket configuration or policy, not only by the UI, with a clear message.
- Given attachments on a record, when I view the record, then I see name, size, uploader and date,
  and downloading uses a short-lived signed URL (60 seconds, hypothesis) or an authenticated download;
  the bucket is private and no public URL exists.
- Given I am a member, when I delete an attachment, then the storage object is removed and then the
  row; the record stays.
- Given a user in workspace A, when they request `GET` or signed-URL creation for any path under
  `{workspace B id}/...`, or try to upload under that prefix, then storage returns 403 or an empty
  result, and nothing is written.
- Given a record is deleted (B2), then its attachment rows cascade and its storage prefix is deleted
  by the same path; a scheduled cleanup of orphaned objects is a Phase 5 operations task.

Workspace isolation: `attachments` rows carry `workspace_id`; the storage policies check that the
first path segment is a workspace the caller belongs to (`is_workspace_member`) for select, insert
and delete, and that the record in the second segment belongs to that workspace. Both the table and
the bucket get the four denial tests in section 7 ("attachments (table and storage)").

Plan limits: each upload adds its size to `storage_bytes` (Free hypothesis: 50 MB, Pro 1 GB,
Business 10 GB) and 1 to `attachments`; deletes subtract. Over the storage limit, downloads keep
working and only new uploads fail.

#### B5 Export a module's records to CSV

As an owner or admin I can export a module's records (optionally the currently filtered set) to a
CSV file, and the export is audited.

Acceptance criteria
- Given I am an owner or admin, when I click "Export CSV" on a module, then the client calls the
  Edge Function `export-records` with the workspace id, module id and the active filters, and
  receives `text/csv; charset=utf-8` with a UTF-8 BOM named `{module-slug}-{YYYY-MM-DD}.csv`.
- Given the CSV, then the header is `id`, `created_at`, `updated_at`, `created_by` (display name,
  not email) followed by the field labels in module order; deleted fields are not included; values
  are formatted as: date `YYYY-MM-DD`, checkbox `true`/`false`, select the current option label (or
  the stored key when the option was removed), number and currency plain decimals with a dot, text
  raw. Quoting follows RFC 4180.
- Given a cell that starts with `=`, `+`, `-`, `@`, tab or carriage return, then it is prefixed with
  a single quote so spreadsheet applications do not execute it (CSV injection).
- Given the function is called by a `member`, by a non-member, or with a module id from another
  workspace, then it returns 403 `forbidden` (one code, so module existence is not revealed) and
  writes nothing.
- Given a successful export, then an audit event `records.exported` is written with
  `{ module_id, row_count, filtered: boolean }` and no record content.
- Given a module with more than 50,000 rows (hypothesis, the Business record ceiling), then the
  function returns a stable `export_too_large` error and the UI asks the user to filter; rate limiting
  of exports is Phase 5.
- Given a Free workspace, then export is still available: data portability is never a paid feature
  (rule 9 and the pilot promise in `docs/product/discovery-kit.md`).

Workspace isolation: the function verifies the JWT, loads the caller's role in the target workspace,
reads records with the service role only after that check and only with `workspace_id` and
`module_id` bound in the query; section 7 lists the 403 cases to verify by HTTP.

Plan limits: exports are not metered in the MVP. The row cap is a safety limit, not an entitlement.

#### B6 Start a module from a template

As an owner or admin of a workspace with no modules I can create my first module from a template
so the recommended workflow is set up in one step; the default template is the D1 module.

Acceptance criteria
- Given templates are shipped as versioned code inside the frontend domain module (not as database
  rows), then the MVP ships two: "Blank" (no fields) and the D1 default. Until D1 is decided the
  default is "Housekeeping tasks" with the 8 fields in `docs/product/segment-comparison.md` (Room
  select required; Due date date required; Task type select required; Status select required;
  Assigned to text; Guests arriving number; Notes text; Inspected checkbox). If D1 lands elsewhere,
  only this template changes.
- Given I am an owner or admin and the workspace has zero modules, when I open the dashboard, then I
  see "Start from a template" with each template's name, description and a read-only preview of its
  fields, plus "Blank module".
- Given I pick a template, when I confirm (the module name is prefilled and editable), then the
  module and all its fields and options are created atomically in one SQL function or Edge Function
  (the same path B1 uses to create a module with fields), in a single transaction, so a partially
  applied template never exists.
- Given the module exists, then it has no live link to the template: later template changes do not
  alter it, and the user edits fields and options exactly as in B1 (for example renaming the
  placeholder rooms). A `module.created` audit event with `{ name, template }` records which template
  was used (`template: null` for manual creation) for pilot analytics.
- Given a module with the template's name already exists in the workspace, then the name is suffixed
  "(2)" before saving, or I rename it.
- Given I am a `member`, then I do not see the template chooser and the creation path denies me as
  in B1.
- Given a workspace that already has modules, then the template chooser is still reachable from
  "New module" and behaves the same.

Workspace isolation: templates are global, read-only and contain no tenant data; applying one writes
rows only into the caller's workspace through the B1 path, so no new table, policy or storage
surface is introduced.

Plan limits: applying a template counts as 1 module toward `modules`; it creates no records. On a
Free workspace (hypothesis: 1 module) the template is therefore the only module, which is the
intended pilot shape.

**Scope note (relationships stay deferred).** While writing these stories the following would have
been natural to add and were kept out on purpose, in line with the D2 recommendation and the
deferred list in section 1: a Rooms or Clients table linked to records (use a `select` or `text`
field); an "Assigned to" field that references workspace members (use `text`); a relation or
lookup field type; multi-select; automatic record creation from external calendars or bookings;
per-record permissions; saved views; soft delete. Any of these moves only when the project lead
explicitly moves it.

### Epic C: Plans and limits
- **C1** As an owner I can see current usage against my plan limits.
- **C2** When a limit is reached, creating the next item fails with a clear message, and no data is deleted.
- **C3** As an owner I can view the audit log of privileged actions.

---

## 7. Workspace isolation acceptance tests (decision D6)

Run with two seeded workspaces (A, B) and one user in each. Every tenant-owned table gets all four rows.

| Table | select B as A returns 0 | insert with B id fails | update B row as A affects 0 | delete B row as A affects 0 |
|-------|:-:|:-:|:-:|:-:|
| workspaces | [x] | [x] | [x] | [x] |
| workspace_members | [x] | [x] | [x] | [x] |
| invitations | [x] | [x] | [x] | [x] |
| modules | [x] | [x] | [x] | [x] |
| field_definitions | [x] | [x] | [x] | [x] |
| records | [x] | [x] | [x] | [x] |
| attachments (table and storage) | [ ] | [ ] | [ ] | [ ] |
| audit_events | [x] | [x] | [x] | [x] |
| subscriptions / entitlements / usage_counters | [ ] | [ ] | [ ] | [ ] |

Done cells are proven by `supabase/tests/02_isolation_workspaces.sql`, `03_isolation_members.sql`,
`04_isolation_invitations.sql` and `05_isolation_audit_events.sql` (run with `npm run test:db`, also
in the CI `db-tests` job). For `invitations` and `audit_events` the update and delete cells are
satisfied by a stricter rule: `authenticated` has no update grant on `invitations` and no insert,
update or delete grant on `audit_events`, so the command fails with `permission denied` for every
row, including the caller's own workspace. `profiles` has no `workspace_id` and is covered
separately in `06_isolation_profiles.sql` (own row plus shared-workspace visibility only).

Plus: Edge Functions `invite-member` and `export-records` return 403 when the caller is not a member of the target workspace, and 403 when the caller is a `member` for admin-only actions.

- [x] `invite-member`: verified by HTTP on 2026-10-30 against the local stack (non-member 403, `member` 403, admin inviting as owner 403, owner 200; see `docs/architecture.md`, Edge Functions).
- [ ] `export-records`: Phase 3.

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

Generic templates. The version tailored to the recommended D1 segment (outreach variants, follow-up
prompts, 20-prospect sourcing checklist, interview note template, pilot offer with dates from a
2026-11-17 start) is in `docs/product/discovery-kit.md` (2026-11-03).

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
| 2026-11-03 | Recommendation (not decision) for D1: accommodation operators, housekeeping turnover tracking, default module "Housekeeping tasks"; S1 service offices as fallback; S2 retail rejected | Best reachability for a solo founder and the only candidate workflow that fits one flat module without relationships; see `docs/product/segment-comparison.md`. Decision remains with the project lead, due 2026-11-15 |
