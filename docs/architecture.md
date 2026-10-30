# Architecture

Database and backend reference. Maintained by the `supabase-engineer` agent; every new table,
function or policy is documented here in the same change that introduces it.
Last updated: 2026-10-30 (migration 001).

## Tenancy model

- A **workspace** is the tenant. Every tenant-owned row carries `workspace_id uuid not null
  references public.workspaces(id) on delete cascade` with an index.
- A **user** (Supabase Auth, `auth.users`) has one `public.profiles` row and may belong to any
  number of workspaces through `public.workspace_members`, each with exactly one role:
  `owner`, `admin` or `member` (enum `public.workspace_role`).
- Authorization is enforced by Row Level Security in Postgres. The browser uses the anon key and a
  user JWT; policies decide what each query may see or change. UI hiding is never the enforcement.
- Privileged actions that need cross-row checks or secrets (accepting invitations, plan limits,
  exports) go through Edge Functions (Part 4 and later) using the service-role key, which never
  reaches the browser.
- Every privileged write produces a `public.audit_events` row. In migration 001 these are written
  by triggers; Edge Functions will add their own.

Role capabilities in migration 001:

| Capability                                   | owner | admin | member |
| -------------------------------------------- | :---: | :---: | :----: |
| Read workspace, members, audit log           |  yes  |  yes  |  yes   |
| Rename workspace / change slug               |  yes  |  yes  |   no   |
| Delete workspace                             |  yes  |  no   |   no   |
| Add member as `member` or `admin`            |  yes  |  yes  |   no   |
| Add member as `owner`                        |  yes  |  no   |   no   |
| Change a member's role                       |  yes  |  no   |   no   |
| Remove a non-owner member                    |  yes  |  yes  |   no   |
| Remove an owner (never the last one)         |  yes  |  no   |   no   |
| Leave the workspace (never as the last owner) |  yes  |  yes  |  yes   |
| Create, list, revoke invitations             |  yes  |  yes  |   no   |
| Invite as `owner`                            |  yes  |  no   |   no   |

## Tables (migration `20261030120000_001_tenancy.sql`)

All tables live in `public`, have RLS enabled, grant nothing to `anon`, and grant `authenticated`
only the commands that have a policy. `service_role` keeps its default full access for Edge
Functions and CI.

### `profiles`

Public mirror of `auth.users`, one row per user. Created by the `on_auth_user_created` trigger on
`auth.users`; clients never insert or delete it.

| Column       | Type        | Notes                                             |
| ------------ | ----------- | ------------------------------------------------- |
| `id`         | uuid PK     | `references auth.users(id) on delete cascade`     |
| `email`      | text        | not null, copied from `auth.users.email`          |
| `full_name`  | text        | from `raw_user_meta_data.full_name` at signup     |
| `avatar_url` | text        |                                                   |
| `created_at` | timestamptz | default `now()`                                   |
| `updated_at` | timestamptz | default `now()`, maintained by `set_updated_at()` |

Column grant: `authenticated` may update only `full_name` and `avatar_url`.

### `workspaces`

The tenant.

| Column       | Type        | Notes                                                                 |
| ------------ | ----------- | --------------------------------------------------------------------- |
| `id`         | uuid PK     | default `gen_random_uuid()`                                           |
| `name`       | text        | not null, 1..100 chars                                                |
| `slug`       | text        | not null, unique, `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..60 chars             |
| `created_by` | uuid        | `references auth.users(id) on delete set null`; drives owner creation |
| `created_at` | timestamptz |                                                                       |
| `updated_at` | timestamptz | maintained by `set_updated_at()`                                      |

Trigger `on_workspace_created` (after insert) inserts `created_by` as `owner` into
`workspace_members` and writes a `workspace.created` audit event, so creating a workspace is one
atomic statement from the client. Part 4 may move this into the `create-workspace` Edge Function
once plan limits must be checked first. Column grant: `authenticated` may update only `name` and
`slug`.

### `workspace_members`

Membership and role. The single source of truth for all RLS decisions.

| Column         | Type             | Notes                                            |
| -------------- | ---------------- | ------------------------------------------------ |
| `workspace_id` | uuid             | PK part, `references workspaces on delete cascade` |
| `user_id`      | uuid             | PK part, `references auth.users on delete cascade` |
| `role`         | `workspace_role` | not null, default `member`                       |
| `created_at`   | timestamptz      |                                                  |
| `updated_at`   | timestamptz      | maintained by `set_updated_at()`                 |

Indexes: PK `(workspace_id, user_id)`, `workspace_members_user_id_idx (user_id)`.

Triggers:

- `workspace_members_protect_last_owner` (before update or delete): raises `P0001` when the change
  would leave the workspace with zero owners. It lets the cascade from a workspace delete through.
- `workspace_members_audit` (after insert, update, delete): writes `member.added`,
  `member.role_changed` (only when `role` changed) and `member.removed`.

Column grant: `authenticated` may update only `role`.

### `invitations`

Pending invitations by email. Acceptance (matching the token, creating the membership, stamping
`accepted_at`) is an Edge Function in Part 4; clients cannot update this table.

| Column         | Type             | Notes                                                        |
| -------------- | ---------------- | ------------------------------------------------------------ |
| `id`           | uuid PK          | default `gen_random_uuid()`                                  |
| `workspace_id` | uuid             | not null, `references workspaces on delete cascade`          |
| `email`        | text             | not null, 3..320 chars                                       |
| `role`         | `workspace_role` | not null, default `member`                                   |
| `token`        | text             | not null, unique, default 64 hex chars from `gen_random_bytes(32)` |
| `invited_by`   | uuid             | `references auth.users on delete set null`                   |
| `expires_at`   | timestamptz      | not null, default `now() + 7 days`                           |
| `accepted_at`  | timestamptz      | null until accepted                                          |
| `created_at`   | timestamptz      |                                                              |

Indexes: `invitations_workspace_id_idx (workspace_id)`, `invitations_email_lower_idx (lower(email))`.

Trigger `invitations_audit` (after insert, delete): writes `invitation.created` and
`invitation.revoked`. The token is never written to the audit log.

### `audit_events`

Append-only log of privileged actions. Clients can read their workspaces' events and never write.

| Column         | Type           | Notes                                                       |
| -------------- | -------------- | ----------------------------------------------------------- |
| `id`           | bigint identity PK |                                                         |
| `workspace_id` | uuid           | not null, `references workspaces on delete cascade`         |
| `actor_id`     | uuid           | `references auth.users on delete set null`; null for system/seed |
| `action`       | text           | not null, dotted verb (see below)                           |
| `entity_type`  | text           | not null, e.g. `workspace`, `workspace_member`, `invitation` |
| `entity_id`    | text           | id of the affected entity as text                           |
| `metadata`     | jsonb          | not null, default `{}`                                      |
| `created_at`   | timestamptz    |                                                             |

Index: `audit_events_workspace_created_idx (workspace_id, created_at desc)`.

Actions written in migration 001: `workspace.created`, `member.added`, `member.role_changed`,
`member.removed`, `invitation.created`, `invitation.revoked`.

## Functions

All RLS helpers are `security definer`, `stable`, `set search_path = ''`, executable by
`authenticated` only (revoked from `public` and `anon`). They never accept the caller's identity
as a parameter; it always comes from `auth.uid()`.

| Function                                             | Returns      | Purpose                                                          |
| ---------------------------------------------------- | ------------ | ---------------------------------------------------------------- |
| `is_workspace_member(p_workspace_id uuid)`           | boolean      | Caller has any role in the workspace.                            |
| `has_workspace_role(p_workspace_id uuid, p_roles workspace_role[])` | boolean | Caller holds one of the given roles in the workspace.   |
| `current_user_workspace_ids()`                       | setof uuid   | All workspace ids the caller belongs to.                         |
| `shares_workspace_with(p_user_id uuid)`              | boolean      | Caller and `p_user_id` share at least one workspace (profiles).  |

Trigger functions (not executable by any API role):

| Function                         | Fires on                                  | Purpose                                              |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `set_updated_at()`               | before update, all tables with `updated_at` | Stamps `updated_at = now()`.                       |
| `handle_new_user()`              | after insert on `auth.users`              | Creates the `profiles` row. Security definer.        |
| `handle_new_workspace()`         | after insert on `workspaces`              | Owner membership + `workspace.created`. Security definer. |
| `protect_last_owner()`           | before update/delete on `workspace_members` | Rejects removing or demoting the last owner.       |
| `audit_workspace_member_change()`| after insert/update/delete on `workspace_members` | Membership audit events.                     |
| `audit_invitation_change()`      | after insert/delete on `invitations`      | Invitation audit events.                             |

## Policy matrix

One policy per command, named `<table>_<command>_<who>`. "none" means the command has no policy
and no table grant, so it is denied for `authenticated`. `o/a` means owner or admin.

| Table               | select                                          | insert                                                         | update                                              | delete                                                                 |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `profiles`          | own row, or `shares_workspace_with(id)`         | none (trigger)                                                 | own row; check `id = auth.uid()`; cols `full_name`, `avatar_url` | none                                                      |
| `workspaces`        | `is_workspace_member(id)`                       | check `created_by = auth.uid()`                                | o/a; cols `name`, `slug`                            | owner                                                                  |
| `workspace_members` | `is_workspace_member(workspace_id)`             | o/a; new `role = 'owner'` only if actor is owner               | owner; col `role`; last-owner trigger               | self, or owner, or admin when target `role <> 'owner'`; last-owner trigger |
| `invitations`       | o/a                                             | o/a; `invited_by = auth.uid()`; `role = 'owner'` only if owner | none (Edge Function in Part 4)                      | o/a                                                                    |
| `audit_events`      | `is_workspace_member(workspace_id)`             | none                                                           | none                                                | none                                                                   |

Policy names:

```
profiles_select_self_or_shared_workspace   profiles_update_self
workspaces_select_member                   workspaces_insert_creator
workspaces_update_owner_admin              workspaces_delete_owner
workspace_members_select_member            workspace_members_insert_owner_admin
workspace_members_update_owner             workspace_members_delete_owner_admin_or_self
invitations_select_owner_admin             invitations_insert_owner_admin
invitations_delete_owner_admin             audit_events_select_member
```

## RLS recursion note

`workspace_members` has RLS enabled and its own policies call `is_workspace_member`, which reads
`workspace_members`. If the helper ran with the caller's privileges, evaluating the policy would
evaluate the policy again and Postgres would raise `infinite recursion detected in policy`. The
helpers are therefore `security definer`: they run as the function owner (`postgres`), which
bypasses RLS, and the recursion never starts. This is also why no policy may inline a subquery on
`workspace_members`; the only place that table is queried for authorization is inside the helpers.
`set search_path = ''` and fully qualified names prevent search-path hijacking of a security
definer function.

## Seed identities (`supabase/seed.sql`, `tests/fixtures/ids.ts`)

| Entity      | Id                                     | Details                                    |
| ----------- | -------------------------------------- | ------------------------------------------ |
| alice       | `00000000-0000-0000-0000-00000000000a` | `alice@example.com`, password `password123` |
| bob         | `00000000-0000-0000-0000-00000000000b` | `bob@example.com`, password `password123`   |
| Workspace A | `00000000-0000-0000-0000-0000000000aa` | slug `workspace-a`, owner alice             |
| Workspace B | `00000000-0000-0000-0000-0000000000bb` | slug `workspace-b`, owner bob               |

Alice is not a member of B and Bob is not a member of A. The seed inserts `auth.users` and
`auth.identities` directly (local only), and inserts the workspaces with `created_by` set so the
`on_workspace_created` trigger produces the memberships and audit rows.

## Still to come

- Part 3: pgTAP/SQL tests in `supabase/tests` proving the matrix above and the cross-workspace
  denials in `docs/PLANNING.md` section 7 for all five tables.
- Part 4: Edge Functions `create-workspace` (may replace the `on_workspace_created` trigger when
  plan limits land), `invite-member`, `accept-invitation` (the only path that updates
  `invitations.accepted_at`).
- Phase 3: migration 002 (`modules`, `field_definitions`, `records`, `attachments`) and the
  `attachments` storage bucket.
- Phase 4: migration 003 (billing tables) and `check_entitlement`.
