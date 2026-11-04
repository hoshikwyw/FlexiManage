# Architecture

Database and backend reference. Maintained by the `supabase-engineer` agent; every new table,
function or policy is documented here in the same change that introduces it.
Last updated: 2026-11-05 (migration 007, plans, subscriptions and server-side plan limits with
error contract C6, Edge Function `change-plan`: see [Plans and limits](#plans-and-limits-migration-20261106090000_007_plans_and_entitlementssql)).
Previous: 2026-11-04 (migration 006, Phase 3 review fixes).

## Tenancy model

- A **workspace** is the tenant. Every tenant-owned row carries `workspace_id uuid not null
  references public.workspaces(id) on delete cascade` with an index.
- A **user** (Supabase Auth, `auth.users`) has one `public.profiles` row and may belong to any
  number of workspaces through `public.workspace_members`, each with exactly one role:
  `owner`, `admin` or `member` (enum `public.workspace_role`).
- Authorization is enforced by Row Level Security in Postgres. The browser uses the anon key and a
  user JWT; policies decide what each query may see or change. UI hiding is never the enforcement.
- Privileged actions that need cross-row checks or secrets (inviting, accepting invitations, plan
  limits, exports) go through Edge Functions (see [Edge Functions](#edge-functions-supabasefunctions))
  which verify the JWT, load the caller's role and only then act. The service-role key is used
  inside functions for lookups RLS would block; it never reaches the browser.
- Every privileged write produces a `public.audit_events` row. Membership and invitation changes
  are written by triggers (migration 001); `accept_invitation()` writes `invitation.accepted`
  (migration 002); future functions use `writeAudit` from the shared toolkit. Invitation events
  never carry the invitee's email or the token (migration 003).
- Joining a workspace has exactly two paths: creating it (the creator becomes owner through
  the `on_workspace_created` trigger) and accepting an invitation (`accept_invitation()`).
  Nobody, not even an owner, inserts into `workspace_members` directly (migration 003).

Role capabilities (migrations 001 and 003):

| Capability                                   | owner | admin | member |
| -------------------------------------------- | :---: | :---: | :----: |
| Read workspace, members, audit log           |  yes  |  yes  |  yes   |
| Rename workspace / change slug               |  yes  |  yes  |   no   |
| Delete workspace                             |  yes  |  no   |   no   |
| Add a member directly (any role)             |  no   |  no   |   no   |
| Change a member's role                       |  yes  |  no   |   no   |
| Remove a non-owner member                    |  yes  |  yes  |   no   |
| Remove an owner (never the last one)         |  yes  |  no   |   no   |
| Leave the workspace (never as the last owner) |  yes  |  yes  |  yes   |
| Create, list, revoke invitations             |  yes  |  yes  |   no   |
| Invite as `owner`                            |  yes  |  no   |   no   |
| Join a workspace (accept an invitation)      | invitee only: `accept_invitation()` | | |
| Read modules, fields, records (migration 004) |  yes  |  yes  |  yes   |
| Create, edit, reorder, delete modules        |  yes  |  yes  |   no   |
| Create, edit, delete field definitions       |  yes  |  yes  |   no   |
| Create, edit, delete records (any author)    |  yes  |  yes  |  yes   |
| Call `workspace_usage(workspace_id)`         |  yes  |  yes  |  yes   |
| Read and download attachments (005; download through `attachment-url` since 006) |  yes  |  yes  |  yes   |
| Add an attachment (upload)                   |  yes  |  yes  |  yes   |
| Delete own attachment                        |  yes  |  yes  |  yes   |
| Delete another member's attachment           |  yes  |  yes  |   no   |
| Export a module to CSV (`export-records`)    |  yes  |  yes  |   no   |
| Read the plan catalogue and the workspace's subscription (007) |  yes  |  yes  |  yes   |
| Call `workspace_entitlements(workspace_id)` (007) |  yes  |  yes  |  yes   |
| Change the workspace's plan (007)            | no (operators: `change-plan`) | no | no |

Records are writable by every member, including records created by someone else. This is the MVP
rule (migration 004): a small team shares one data set, and per-record ownership or a read-only
role is a Phase 4 decision. Record deletes are audited since migration 006 (`record.deleted`);
record creates and edits are not.

## Tables (migration `20261030120000_001_tenancy.sql`, amended by 003)

All tables live in `public`, have RLS enabled, grant nothing to `anon`, and grant `authenticated`
only the commands that have a policy. `service_role` keeps its default full access for Edge
Functions and CI.

### `profiles`

Public mirror of `auth.users`, one row per user. Created by the `on_auth_user_created` trigger on
`auth.users`; clients never insert or delete it. `email` follows `auth.users.email` through the
`on_auth_user_email_changed` trigger (migration 003), so a confirmed email change is visible to
co-members without a re-login.

| Column       | Type        | Notes                                                                      |
| ------------ | ----------- | -------------------------------------------------------------------------- |
| `id`         | uuid PK     | `references auth.users(id) on delete cascade`                              |
| `email`      | text        | not null, copied from `auth.users.email` at signup and on every email change |
| `full_name`  | text        | from `raw_user_meta_data.full_name` at signup (truncated to 100); `profiles_full_name_length_check` `char_length <= 100` |
| `avatar_url` | text        | `profiles_avatar_url_check`: null, or `https://...` and `char_length <= 2048`; a non-conforming signup value is dropped |
| `created_at` | timestamptz | default `now()`                                                            |
| `updated_at` | timestamptz | default `now()`, maintained by `set_updated_at()`                          |

Column grant: `authenticated` may update only `full_name` and `avatar_url`. A check violation
surfaces as SQLSTATE `23514` with the constraint name.

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

Membership and role. The single source of truth for all RLS decisions. Rows are created only by
`handle_new_workspace()` (creator becomes owner) and `accept_invitation()`; `authenticated` has
no insert grant and no insert policy since migration 003.

| Column         | Type             | Notes                                            |
| -------------- | ---------------- | ------------------------------------------------ |
| `workspace_id` | uuid             | PK part, `references workspaces on delete cascade` |
| `user_id`      | uuid             | PK part, `references auth.users on delete cascade` |
| `role`         | `workspace_role` | not null, default `member`                       |
| `created_at`   | timestamptz      | "joined at"; orders succession on account deletion |
| `updated_at`   | timestamptz      | maintained by `set_updated_at()`                 |

Indexes: PK `(workspace_id, user_id)`, `workspace_members_user_id_idx (user_id)`.

Triggers:

- `workspace_members_protect_last_owner` (before update or delete): raises `P0001` when the change
  would leave the workspace with zero owners. Before counting it takes
  `pg_advisory_xact_lock(hashtext('workspace_members:' || workspace_id))`, so two transactions
  each removing one of two owners serialise and the second one fails (migration 003). It lets
  two cascades through: a workspace delete (the workspace row is already gone) and an
  `auth.users` delete (the user row is already gone; see [Account deletion](#account-deletion)).
- `workspace_members_audit` (after insert, update, delete): writes `member.added`,
  `member.role_changed` (only when `role` changed) and `member.removed`. `actor_id` is
  `auth.uid()`, which is null when the write comes from GoTrue, the service role or a
  system trigger.

Column grant: `authenticated` may update only `role`; select and delete at table level.

### `invitations`

Pending invitations by email. Acceptance (matching the token, creating the membership, stamping
`accepted_at`) is the Postgres function `accept_invitation(p_token)` from migration 002, called by
the `accept-invitation` Edge Function; clients cannot update this table.

Lifecycle: `created` (insert by owner/admin, directly or via `invite-member`) -> `accepted`
(`accepted_at` set by `accept_invitation()`, token consumed) | `revoked` (row deleted by
owner/admin under RLS) | `expired` (`expires_at <= now()`, row kept; accepting fails with 410).
At most one pending row per workspace and address exists (`invitations_pending_unique`,
migration 003): `invite-member` returns the existing unexpired one, deletes an expired one before
re-inviting, and a direct duplicate insert fails with `23505`. To change the role, revoke and
invite again.

| Column         | Type             | Notes                                                        |
| -------------- | ---------------- | ------------------------------------------------------------ |
| `id`           | uuid PK          | default `gen_random_uuid()`; not insertable by clients       |
| `workspace_id` | uuid             | not null, `references workspaces on delete cascade`          |
| `email`        | text             | not null, 3..320 chars, `invitations_email_format_check` (`~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'`) |
| `role`         | `workspace_role` | not null, default `member`                                   |
| `token`        | text             | not null, unique, default 64 hex chars from `gen_random_bytes(32)`; **not readable or writable by `authenticated`** |
| `invited_by`   | uuid             | `references auth.users on delete set null`                   |
| `expires_at`   | timestamptz      | not null, default `now() + 7 days`; not insertable by clients |
| `accepted_at`  | timestamptz      | null until accepted; not insertable by clients               |
| `created_at`   | timestamptz      |                                                              |

Indexes: `invitations_workspace_id_idx (workspace_id)`, `invitations_email_lower_idx (lower(email))`,
`invitations_pending_unique (workspace_id, lower(email)) where accepted_at is null` (unique).

Grants for `authenticated` (migration 003) are column-level: select on every column except
`token`; insert on `workspace_id, email, role, invited_by` only; delete at table level; no
update. A `select *` or `select token` through PostgREST is therefore a `42501` (HTTP 403), not
an empty result; clients list the eight visible columns explicitly.

Trigger `invitations_audit` (after insert, delete): writes `invitation.created` and
`invitation.revoked` with metadata `{ invitation_id, role }` (plus `accepted` on revoke). Neither
the token nor the invitee's email is written to the audit log.

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

Actions and metadata (migrations 001 to 005 and the Edge Functions):

| Action                | Written by                                   | `entity_type` / `entity_id`       | `metadata`                                  |
| --------------------- | -------------------------------------------- | --------------------------------- | ------------------------------------------- |
| `workspace.created`   | `handle_new_workspace()`                     | `workspace` / workspace id        | `{ name, slug }`                            |
| `member.added`        | `audit_workspace_member_change()`            | `workspace_member` / user id      | `{ role }`                                  |
| `member.role_changed` | `audit_workspace_member_change()`            | `workspace_member` / user id      | `{ from, to }`                              |
| `member.removed`      | `audit_workspace_member_change()`            | `workspace_member` / user id      | `{ role }`                                  |
| `invitation.created`  | `audit_invitation_change()`                  | `invitation` / invitation id      | `{ invitation_id, role }`                   |
| `invitation.revoked`  | `audit_invitation_change()`                  | `invitation` / invitation id      | `{ invitation_id, role, accepted }`         |
| `invitation.accepted` | `accept_invitation()`                        | `invitation` / invitation id      | `{ invitation_id, role, already_member }`   |
| `module.created`      | `audit_module_change()` (004)                | `module` / module id              | `{ name, slug }`                            |
| `module.updated`      | `audit_module_change()` (004), only when `name` or `slug` changed | `module` / module id | `{ from: { name, slug }, to: { name, slug } }` |
| `module.deleted`      | `audit_module_change()` (004)                | `module` / module id              | `{ name, slug }`                            |
| `field.created`       | `audit_field_change()` (004)                 | `field_definition` / field id     | `{ module_id, key, type, label }`           |
| `field.deleted`       | `audit_field_change()` (004)                 | `field_definition` / field id     | `{ module_id, key, type, label }`           |
| `attachment.added`    | `audit_attachment_change()` (005)            | `attachment` / attachment id      | `{ record_id, file_name, size_bytes }`      |
| `attachment.removed`  | `audit_attachment_change()` (005), direct deletes and `sweep_stale_attachments()` (actor null) | `attachment` / attachment id | `{ record_id, file_name, size_bytes }` |
| `attachment.rejected` | `reconcile_attachment_object()` (006): a stored object did not match its row, or would be an 11th uploaded file | `attachment` / attachment id | `{ record_id, file_name, size_bytes, object_size_bytes, object_content_type, reason }`; `reason` is `size_mismatch`, `content_type_mismatch` or `too_many_files`; actor = the row's uploader |
| `record.deleted`      | `audit_record_delete()` (006), not for module or workspace cascades | `record` / record id | `{ module_id, title, attachment_count }` |
| `records.exported`    | `export-records` Edge Function (`writeAudit`) | `module` / module id            | `{ module_id, row_count, filtered }`        |

Module changes to `position`, `description` or `icon` and field updates (label, required,
position, options, settings, type) are not audited. Fields removed by a module delete are not
audited one by one: the single `module.deleted` row stands for them; likewise records removed by
a module delete get no `record.deleted`. **Record creates and edits produce no audit events**
(volume: every edit of every row); record deletes do since migration 006. A rejected upload
writes `attachment.rejected` instead of `attachment.removed`.

Invitation metadata never contains the invitee's email (privacy: the audit log is readable by
every member) nor the token. Accepting an invitation produces two rows: `member.added` from the
membership trigger and `invitation.accepted` from the function, both with the invitee as
`actor_id`. `actor_id` is null for rows written without a JWT (seed, GoTrue-triggered account
deletion, service role). There is no `workspace.deleted` row: audit rows cascade with the
workspace (same for an owner-initiated delete); a tenant-independent log is a Phase 5 topic.

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
| `workspace_usage(p_workspace_id uuid)` (004, recreated in 005) | one row `(modules int, records int, members int, attachments int, storage_bytes bigint)` | Counts for the usage badges; see [workspace_usage](#workspace_usagep_workspace_id-uuid). The plan-limit check counts with `entitlement_usage` instead (007). |
| `can_upload_attachment_object(p_name text, p_metadata jsonb)` (005, replaced in 006) | boolean | `storage.objects` insert policy: metadata present; a pending (`uploaded_at` null, < 1 hour old) row uploaded by the caller (still a member); metadata `mimetype` equals `content_type` and `size` (when present) equals `size_bytes`; no object yet. |

`can_read_attachment_object` and `can_delete_attachment_object` (005) were dropped in migration
006 together with the storage select and delete policies.

Callable functions added in migration 006:

| Function | Security | Callable by | Purpose |
| -------- | -------- | ----------- | ------- |
| `update_record(p_record_id uuid, p_expected_updated_at timestamptz, p_patch jsonb)` returns `records` | invoker (RLS applies) | `authenticated` | Contract C3: optimistic-concurrency record update; see [update_record](#update_record-contract-c3). |
| `sweep_stale_attachments()` returns integer | definer | `service_role`, pg_cron | Deletes attachments rows still pending one hour after insert. |
| `invoke_purge_attachments()` returns bigint | definer | postgres (pg_cron) only | POSTs `{"limit": 500}` to `purge-attachments` through pg_net with the key from Vault. |
| `schedule_storage_maintenance()` returns text | definer | postgres only | Creates the pg_cron jobs (idempotent); see [Schedule](#schedule-pg_cron--pg_net--vault). |

Pure helpers (migration 004) are `immutable`, not security definer, and keep the default
`execute` for every role: they are called from check constraints and a generated column, which
Postgres evaluates with the privileges of the role that writes the row (also `service_role`).

| Function                                                   | Purpose                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `jsonb_values_text(jsonb)`                                 | Space-separated text of the top-level string and number values of an object (`''` otherwise). Feeds `records.search_vector`. |
| `field_options_are_valid(field_type, jsonb)`               | `field_definitions_options_check`: select needs 1..100 `{value, label}` objects with distinct values; other types need `[]`. |
| `field_settings_are_valid(field_type, jsonb)`              | `field_definitions_settings_check`: object; `currency.currency` is `^[A-Z]{3}$`; `number`/`currency.precision` is an integer 0..6. Unknown keys pass. |
| `attachment_content_type_is_allowed(text)` (005)          | `attachments_content_type_check`: the eleven allowed MIME types (same list as the bucket). |
| `attachment_file_name_is_valid(text)` (005)               | `attachments_file_name_check`: 1..255 chars, trimmed, Storage-safe key characters only. |
| `text_is_blank(text)` (006)                               | Null, `''` or only whitespace (the set JavaScript `trim()` removes: ASCII whitespace, NBSP, U+1680, U+2000-200A, U+2028/2029, U+202F, U+205F, U+3000, U+FEFF). `records_title_not_blank_check`, required fields, the field guards. |
| `record_search_document(text, text, jsonb)` (006)         | `records.search_vector`: tsvector of title, status and custom values indexed whole, split at `@` and split into alphanumeric parts (C4). |

### `accept_invitation(p_token text)` (migration `20261030150000_002_accept_invitation.sql`)

`security definer`, `set search_path = ''`, `volatile`. Executable by `authenticated` only; revoked
from `public`, `anon` and `service_role`, so nobody can accept on another user's behalf: the
caller is always `auth.uid()`. Returns one row `(workspace_id, workspace_name, workspace_slug,
role)`. In a single transaction it:

1. Rejects when `auth.uid()` is null or has no `auth.users` row (`PT401`).
2. Locks the invitation row by token (`for update`). Unknown token or `accepted_at` already set:
   `PT404` (tokens are one-shot; a second call is a clean error, not an idempotent success).
3. `expires_at <= now()`: `PT410`.
4. Compares `lower(invitations.email)` with the caller's `auth.users.email` (not the JWT claim,
   which can be stale after an email change) and requires `email_confirmed_at`: otherwise `PT403`.
5. Inserts the membership with the invited role unless the caller is already a member (then the
   existing role is kept), stamps `accepted_at = now()` and writes `invitation.accepted` with
   `{ invitation_id, role, already_member }` (migration 003 removed `email`).

The `PTxxx` SQLSTATEs make PostgREST return that HTTP status when the function is called through
the REST API directly; the Edge Function maps them to stable error codes (table below).

Trigger functions (not executable by any API role):

| Function                         | Fires on                                  | Purpose                                              |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `set_updated_at()`               | before update, all tables with `updated_at` | Stamps `updated_at = now()`.                       |
| `handle_new_user()`              | after insert on `auth.users` (`on_auth_user_created`) | Creates the `profiles` row; `full_name` truncated to 100, `avatar_url` kept only when https and <= 2048. Security definer. |
| `handle_user_email_changed()`    | after update of `email` on `auth.users` (`on_auth_user_email_changed`, migration 003) | Mirrors the new address into `profiles.email`. Security definer. |
| `handle_user_deleted()`          | before delete on `auth.users` (`on_auth_user_deleted`, migration 003) | Owner succession or workspace deletion for the user's solely-owned workspaces. Security definer. |
| `handle_new_workspace()`         | after insert on `workspaces`              | Owner membership + `workspace.created`. Security definer. |
| `protect_last_owner()`           | before update/delete on `workspace_members` | Rejects removing or demoting the last owner; per-workspace advisory lock. Security definer. |
| `audit_workspace_member_change()`| after insert/update/delete on `workspace_members` | Membership audit events.                     |
| `audit_invitation_change()`      | after insert/delete on `invitations`      | Invitation audit events (`invitation_id`, `role`; no email). |
| `validate_record_custom_values()` (004) | before insert, before update of `custom_values`, `module_id` on `records` (`records_validate_custom_values`) | Keys, required fields and value types against the module's `field_definitions`; raises 23514 `custom_values.<key>: <reason>`. Security definer. |
| `protect_field_definition()` (004) | before update on `field_definitions` (`field_definitions_protect`) | `key` immutable; `type` frozen while values exist; select options in use cannot be removed. Security definer. |
| `handle_field_deleted()` (004)   | after delete on `field_definitions` (`field_definitions_strip_values`) | Removes the key from `custom_values` of the module's records. Security definer. |
| `audit_module_change()` (004)    | after insert/update/delete on `modules` (`modules_audit`) | `module.created` / `module.updated` / `module.deleted`. Security definer. |
| `audit_field_change()` (004)     | after insert/delete on `field_definitions` (`field_definitions_audit`) | `field.created` / `field.deleted`. Security definer. |
| `enforce_attachment_cap()` (005) | before insert on `attachments` (`attachments_enforce_cap`) | At most 10 per record; per-record advisory lock; 23514 `attachments: at most 10 files per record`. Security definer. |
| `audit_attachment_change()` (005) | after insert/delete on `attachments` (`attachments_audit`) | `attachment.added` / `attachment.removed` (not for cascades). Security definer. |
| `enqueue_attachment_object_deletion()` (005) | after delete on `attachments` (`attachments_enqueue_object_deletion`) | Inserts the object into `storage_deletion_queue`, also for cascades. Security definer. |
| `audit_record_delete()` (006)    | before delete on `records` (`records_audit_delete`) | `record.deleted { module_id, title, attachment_count }`; skipped when the module or workspace is gone (cascade). Security definer. |
| `reconcile_attachment_object()` (006) | after insert or update of `metadata` on `storage.objects` when `bucket_id = 'attachments'` (`attachments_reconcile_object`) | Compares the stored size and MIME type with the row: match stamps `uploaded_at`; mismatch or an 11th uploaded file deletes the row and writes `attachment.rejected`; an object without a row is queued. Security definer. |

Migration 006 replaced `validate_record_custom_values()`, `protect_field_definition()`,
`handle_field_deleted()`, `enforce_attachment_cap()` and `audit_attachment_change()` (`create or
replace`; behaviour in the sections below and in
[Phase 3 review fixes](#phase-3-review-fixes-migration-20261105090000_006_phase3_review_fixessql)).

### Account deletion

Deleting a user (GoTrue admin API, dashboard, or a future self-service Edge Function) is a
`delete from auth.users`. Migration 003 makes it safe for the workspaces the user owned:

1. `on_auth_user_deleted` (before delete, row-level) runs while the memberships still exist. For
   every workspace in which the user is an owner it takes the same advisory lock as
   `protect_last_owner()` and then:
   - if another owner exists, does nothing (the cascade removes the membership below);
   - else promotes a successor to `owner`: the earliest-joined `admin` (by
     `workspace_members.created_at`), else the earliest-joined `member`. The membership trigger
     writes `member.role_changed { from, to: 'owner' }` with `actor_id` null;
   - else (the user was the only member) deletes the workspace. Memberships, invitations and
     audit rows cascade, exactly as for an owner-initiated delete. Data that belongs only to a
     deleted person is not kept.
2. The row is deleted; the FK cascades remove `profiles`, the user's `workspace_members` rows
   (`protect_last_owner()` lets them through because the `auth.users` row is gone; each is
   audited as `member.removed` with `actor_id` null) and set `workspaces.created_by`,
   `invitations.invited_by` and `audit_events.actor_id` to null where they pointed at the user.

Rules that follow: a user can always be deleted (the last-owner guard never blocks account
deletion); no workspace is left without an owner; a workspace with other members survives its
owner; a workspace nobody else can reach is removed. Tested in
`supabase/tests/12_review_fixes.sql`. The UI copy for "Delete account" (Phase 5) must say that
solely-owned workspaces are handed to the longest-standing admin or member, and deleted when
empty.

## Policy matrix

One policy per command, named `<table>_<command>_<who>`. "none" means the command has no policy
and no table grant, so it is denied for `authenticated`. `o/a` means owner or admin.

| Table               | select                                          | insert                                                         | update                                              | delete                                                                 |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `profiles`          | own row, or `shares_workspace_with(id)`         | none (trigger)                                                 | own row; check `id = auth.uid()`; cols `full_name`, `avatar_url` | none                                                      |
| `workspaces`        | `is_workspace_member(id)`                       | check `created_by = auth.uid()`                                | o/a; cols `name`, `slug`                            | owner                                                                  |
| `workspace_members` | `is_workspace_member(workspace_id)`             | none (`handle_new_workspace()` and `accept_invitation()` only, since 003) | owner; col `role`; last-owner trigger   | self, or owner, or admin when target `role <> 'owner'`; last-owner trigger |
| `invitations`       | o/a; cols all except `token`                    | o/a; `invited_by = auth.uid()`; `role = 'owner'` only if owner; cols `workspace_id, email, role, invited_by` | none (`accept_invitation()` only) | o/a                                                   |
| `audit_events`      | `is_workspace_member(workspace_id)`             | none                                                           | none                                                | none                                                                   |
| `modules` (004)     | `is_workspace_member(workspace_id)`             | o/a; `created_by = auth.uid()`; cols `workspace_id, name, slug, description, icon, position, created_by` (`id` removed in 006) | o/a; cols `name, slug, description, icon, position` | o/a                                       |
| `field_definitions` (004) | `is_workspace_member(workspace_id)`       | o/a; cols `workspace_id, module_id, key, label, type, required, position, options, settings` (`id` removed in 006) | o/a; cols `key, label, type, required, position, options, settings` (triggers guard `key`/`type`) | o/a |
| `records` (004)     | `is_workspace_member(workspace_id)`             | member; `created_by = auth.uid()`; cols `workspace_id, module_id, title, status, custom_values, created_by` (`id` removed in 006) | member; cols `title, status, custom_values`; or `update_record()` (006) | member                              |
| `attachments` (005) | `is_workspace_member(workspace_id)`             | member; `uploaded_by = auth.uid()` (default, not insertable); cols `workspace_id, record_id, file_name, content_type, size_bytes` | none (immutable) | uploader (still a member), or o/a |
| `storage_deletion_queue` (005) | none                                 | none                                                           | none                                                | none (service role only)                                            |
| `storage.objects` in bucket `attachments` (005, 006) | none since 006 (downloads: `attachment-url`) | `can_upload_attachment_object(name, metadata)` | none | none since 006 (removal: row delete + queue) |
| `plans` (007, global)  | every authenticated user (`using (true)`); `anon` none | none                                                       | none                                                | none                                                                   |
| `subscriptions` (007)  | `is_workspace_member(workspace_id)`             | none (`handle_workspace_subscription()`)                     | none (`change_workspace_plan()`, operators)         | none (workspace cascade)                                               |

Since migration 007 the inserts on `workspaces`, `workspace_members`, `invitations`, `modules`,
`records` and `attachments` are also plan-limited by before-insert triggers (contract C6, see
[Plans and limits](#plans-and-limits-migration-20261106090000_007_plans_and_entitlementssql)).

For the three content tables insert and update are column-level grants, so `created_at`,
`updated_at` and `search_vector` can never be supplied, and `workspace_id`, `module_id` and
`created_by` can never be changed after insert (`42501 permission denied for table ...`).
`search_vector` is a generated column: a value for it fails with `428C9` even before the grant is
consulted. `created_by` defaults to `auth.uid()`, so clients may omit it; supplying someone else
is an RLS violation (`42501 new row violates row-level security policy`).

Policy names (`workspace_members_insert_owner_admin` was dropped in migration 003):

```
profiles_select_self_or_shared_workspace   profiles_update_self
workspaces_select_member                   workspaces_insert_creator
workspaces_update_owner_admin              workspaces_delete_owner
workspace_members_select_member            workspace_members_update_owner
workspace_members_delete_owner_admin_or_self
invitations_select_owner_admin             invitations_insert_owner_admin
invitations_delete_owner_admin             audit_events_select_member
modules_select_member                      modules_insert_owner_admin
modules_update_owner_admin                 modules_delete_owner_admin
field_definitions_select_member            field_definitions_insert_owner_admin
field_definitions_update_owner_admin       field_definitions_delete_owner_admin
records_select_member                      records_insert_member
records_update_member                      records_delete_member
attachments_select_member                  attachments_insert_member
attachments_delete_uploader_or_owner_admin
plans_select_authenticated                 subscriptions_select_member
-- on storage.objects (bucket attachments); the select and delete policies of 005 were
-- dropped in 006:
attachments_objects_insert_uploader
```

## Review fixes (migration `20261102090000_003_review_fixes.sql`)

Applied 2026-11-02 after review round 1 of Phase 2. Each item is a `create or replace`,
`revoke`/`grant` or `alter table` on migration 001/002 objects; nothing was edited in place.

| # | Finding                                                       | Fix                                                                                                  |
| - | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1 | Clients could set `id`, `token`, `expires_at`, `accepted_at` on insert; duplicate pending invitations; no address check | Column-level insert grant; `invitations_pending_unique`; `invitations_email_format_check`; `invite-member` deletes expired rows and maps `23505` to the idempotent response |
| 2 | Owners/admins could read invitation tokens                    | Column-level select grant without `token`                                                            |
| 3 | Owners/admins could add any user to a workspace without consent | Insert grant and policy on `workspace_members` removed; acceptance is the only path                 |
| 4 | Two concurrent owner removals could leave zero owners         | Advisory xact lock per workspace in `protect_last_owner()`                                           |
| 5 | Deleting a sole owner's account failed on the guard or orphaned the workspace | `handle_user_deleted()` succession; guard lets the `auth.users` cascade through       |
| 6 | `profiles.email` went stale after an email change; unbounded `full_name` at signup | `handle_user_email_changed()`; `left(full_name, 100)`                             |
| 7 | No bounds on `profiles.full_name` / `avatar_url`              | Named check constraints                                                                              |
| 8 | Invitee emails in a log readable by every member              | Invitation audit metadata is `{ invitation_id, role, ... }`                                          |

## Content model (migration `20261103090000_004_modules_records.sql`)

Applied 2026-11-03 (Part 10). A **module** is an entity type inside a workspace ("Clients",
"Projects"); its **field definitions** describe the custom columns; a **record** is one row with a
structured core (`title`, `status`) and a `custom_values` JSON object keyed by field key. Every
table carries `workspace_id`; `field_definitions` and `records` also carry `module_id`, and the
pair `(module_id, workspace_id)` is a composite foreign key to `modules (id, workspace_id)`
(`field_definitions_module_workspace_fkey`, `records_module_workspace_fkey`). A row therefore can
never point at a module of another workspace even if its `workspace_id` passes RLS: the insert
fails with `23503`. Deleting a module cascades its fields and records; deleting a workspace
cascades everything. Attachments and the storage bucket are migration 005 (see
[Attachments](#attachments-migration-20261104090000_005_attachmentssql)); plan limits are Phase 4
(`workspace_usage()` below is the hook).

Enum `public.field_type`: `text`, `number`, `date`, `select`, `checkbox`, `currency`.

### `modules`

| Column         | Type        | Notes                                                                       |
| -------------- | ----------- | --------------------------------------------------------------------------- |
| `id`           | uuid PK     | default `gen_random_uuid()`; clients may supply it                          |
| `workspace_id` | uuid        | not null, `references workspaces on delete cascade`; `modules_workspace_id_idx` |
| `name`         | text        | not null, 1..100 chars                                                      |
| `slug`         | text        | not null, `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..60; unique per workspace (`23505` on duplicate; the same slug may exist in another workspace) |
| `description`  | text        | null or <= 500 chars                                                        |
| `icon`         | text        | null or <= 50 chars (icon name chosen by the UI)                            |
| `position`     | integer     | not null, default 0; the client orders, no server renumbering               |
| `created_by`   | uuid        | default `auth.uid()`, `references auth.users on delete set null`; must equal the caller |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by `set_updated_at()`                   |

Unique `(workspace_id, slug)` and unique `(id, workspace_id)` (target of the composite FKs).

### `field_definitions`

| Column         | Type         | Notes                                                                       |
| -------------- | ------------ | --------------------------------------------------------------------------- |
| `id`           | uuid PK      |                                                                             |
| `workspace_id` | uuid         | not null, `references workspaces on delete cascade`; `field_definitions_workspace_id_idx` |
| `module_id`    | uuid         | not null, `references modules on delete cascade`; `(module_id, workspace_id)` composite FK |
| `key`          | text         | not null, `^[a-z][a-z0-9_]{0,49}$`, unique per module; **immutable** (`23514 field_definitions.key: cannot be changed`) |
| `label`        | text         | not null, 1..100                                                            |
| `type`         | `field_type` | not null; frozen while any record holds a non-null value (see guards)       |
| `required`     | boolean      | not null, default false                                                     |
| `position`     | integer      | not null, default 0; `field_definitions_module_position_idx (module_id, position)` |
| `options`      | jsonb        | not null, default `[]`; `field_definitions_options_check` (see shapes)      |
| `settings`     | jsonb        | not null, default `{}`; `field_definitions_settings_check`                  |
| `created_at`, `updated_at` | timestamptz |                                                                 |

JSON shapes:

- `options` for `select`: `[{ "value": "lead", "label": "Lead" }, ...]`, 1..100 entries, `value`
  and `label` strings of 1..100 chars, values distinct. Every other type: exactly `[]`. Violations
  are `23514` with constraint `field_definitions_options_check`.
- `settings`: always an object. `currency`: optional `"currency": "EUR"` (`^[A-Z]{3}$`).
  `number` and `currency`: optional `"precision": 2` (integer 0..6). Unknown keys are kept.
  Violations are `23514` with constraint `field_definitions_settings_check`.

### `records`

| Column          | Type        | Notes                                                                       |
| --------------- | ----------- | --------------------------------------------------------------------------- |
| `id`            | uuid PK     |                                                                             |
| `workspace_id`  | uuid        | not null, `references workspaces on delete cascade`                         |
| `module_id`     | uuid        | not null, `references modules on delete cascade`; composite FK with `workspace_id` |
| `title`         | text        | not null, 1..200; `records_title_not_blank_check` (006): not only whitespace (`text_is_blank`) |
| `status`        | text        | null or <= 50 chars; free text in the MVP (a module-level status list is a later decision) |
| `custom_values` | jsonb       | not null, default `{}`; `{ "<field key>": value }`, validated by trigger    |
| `search_vector` | tsvector    | generated always as `record_search_document(title, status, custom_values)` stored (rebuilt in 006, see C4); read-only |
| `created_by`    | uuid        | default `auth.uid()`, `references auth.users on delete set null`            |
| `created_at`, `updated_at` | timestamptz |                                                                  |

Indexes: `records_workspace_module_created_idx (workspace_id, module_id, created_at desc)` for
the export order, `records_workspace_module_updated_idx (workspace_id, module_id, updated_at desc,
id)` (006) for the list's default sort, `records_search_vector_idx` (GIN) for full-text search,
`records_custom_values_idx` (GIN `jsonb_path_ops`) for `custom_values @> '{"status": "active"}'`
filters. The title trigram index `records_title_trgm_idx` was dropped in migration 006: the
`title ilike` fallback only runs for search input without a single token and is already narrowed
to one module by the listing indexes (`pg_trgm` stays installed).

Search contract (C4, migration 006): the client builds `tok:* & tok:*` with the C4 tokenizer and
queries `search_vector @@ to_tsquery('simple', ...)`; see
[Search (C4)](#search-tokenizer-and-document-contract-c4). The `simple` configuration does no
stemming and no stop words, so it is language-neutral. Booleans are not indexed (objects and
arrays cannot be stored since 006); numbers are indexed as their text (`4200`). Through
PostgREST: `.textSearch('search_vector', 'acme:*', { config: 'simple' })` or, without tokens,
`.ilike('title', '%...%')`, always with `.eq('workspace_id', id)` (RLS enforces it anyway).

### Custom value validation (`validate_record_custom_values()`)

Runs before insert and before an update that sets `custom_values` or `module_id`. It reads the
module's `field_definitions` and raises SQLSTATE `23514` (`check_violation`) with exactly one of
these messages (first failure wins: object shape, then unknown keys in alphabetical order, then
the fields by `position`, each checking required before type):

| Message                                                | When                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `custom_values: expected object`                       | `custom_values` is not a JSON object                                          |
| `custom_values.<key>: nested objects and arrays are not allowed` | (006) a value is a JSON object or array; checked before every other per-key rule |
| `custom_values.<key>: unknown field`                   | key is not a field of the module (never silently dropped)                     |
| `custom_values.<key>: required`                       | required field absent, `null`, `""` or (006) only whitespace (`text_is_blank`) |
| `custom_values.<key>: expected string`                 | `text` or `select` value is not a JSON string                                 |
| `custom_values.<key>: text longer than 2000 characters` | `text` value longer than 2000 chars                                          |
| `custom_values.<key>: expected number`                 | `number` or `currency` value is not a JSON number                             |
| `custom_values.<key>: number out of range`             | (006) `number` or `currency` with `abs(x) >= 1e15` or more than 6 fractional digits (trailing zeros ignored: `1.1234560` passes) |
| `custom_values.<key>: expected date YYYY-MM-DD`        | `date` value is not a string matching `^\d{4}-\d{2}-\d{2}$` that casts to a date |
| `custom_values.<key>: expected boolean`                | `checkbox` value is not a JSON boolean                                        |
| `custom_values.<key>: not one of the options`          | `select` value is not one of `options[].value` (case-sensitive)              |

Rules: `null` (or absence) is accepted for a non-required field of any type and means "no
value"; values are stored as given (nulls are kept). A required `checkbox` accepts `false`.
Clients map the message with the regex `^custom_values(?:\.([a-z0-9_]+))?: (.+)$` (group 1 = field
key or none, group 2 = reason) and show it on the matching form field. The error also carries
`column = 'custom_values'` in the PostgREST `details`.

Order since 006: object shape, nested values, unknown keys, then the fields. The trigger first
takes `select 1 from modules where id = new.module_id for share`, so a record write and a
concurrent field change on the same module serialise (the field triggers hold `for update`;
verified with two sessions on 2026-11-04: the record insert waits for the field update). The key
strip of `handle_field_deleted()` is skipped through the transaction-local flag
`app.field_strip = 'on'` that the function sets around its update and resets to `off`; migration
004's `pg_trigger_depth() > 1` skip is gone, so no other nested write bypasses validation.

### Field definition guards

`protect_field_definition()` (before update) raises `23514`:

| Message                                                                        | When                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `field_definitions.key: cannot be changed`                                     | `key` differs from the stored one (delete and recreate instead)        |
| `field_definitions.type: cannot be changed while records have a value for "<key>"` | `type` changes and any record of the module has a non-null value under the key |
| `field_definitions.options: option "<value>" is still used by records`         | `select` options change and a record holds a value that is no longer an option |

Allowed without a guard: changing `type` when every record has the key absent or `null`; adding
options; relabelling options; flipping `required` (both ways); every `label`, `position` and
`settings` change. Turning `required` on (or inserting a required field) while records lack the
value leaves those records **stale**: a title-only or status-only update still works, the next
update of `custom_values` (and every new record) must supply the value and otherwise gets
`custom_values.<key>: required`. The UI should prompt for the missing value when it opens such a
record. Changing `type` to `select` needs `options` in the same statement (otherwise
`field_definitions_options_check` fails).

`handle_field_deleted()` (after delete) runs `update records set custom_values = custom_values -
<key>` for the module's records that hold the key, so records never carry a key without a
definition and `custom_values.<key>: unknown field` is raised for later writes. The nested update
skips validation (flag `app.field_strip`, so a stale record does not block the delete) and moves
the affected records' `updated_at`. During a module or workspace cascade the trigger does
nothing.

Since migration 006 both field triggers lock the module row `for update` first, and blank values
(`''` or whitespace only) count as "no value": they neither freeze `type` nor keep an option "in
use". `field_definitions` also has `field_definitions_settings_size_check`
(`pg_column_size(settings) <= 2048`) and `field_definitions_options_size_check`
(`pg_column_size(options) <= 32768`), both `23514`.

### `workspace_usage(p_workspace_id uuid)`

`security definer`, `stable`, `set search_path = ''`, executable by `authenticated` only. Returns
one row `(modules integer, records integer, members integer, attachments integer, storage_bytes
bigint)` for the workspace, counting every module, every record and every membership regardless
of role, every `attachments` row, and the sum of their `size_bytes` (0 when there are none).
Migration 005 recreated it (drop + create, because a new return type cannot be `create or
replace`d); the argument list and the first three columns are unchanged, so existing callers keep
working. `storage_bytes` counts declared sizes of **uploaded** rows only (`uploaded_at is not
null`, migration 006); declared and stored sizes are equal for every uploaded row (the upload
policy and `reconcile_attachment_object()` enforce it). `attachments` still counts every row,
pending ones included. Frontend type contract: `WorkspaceUsageRow` in `src/types/database.ts` is the full
row; since Part 14 (2026-11-04) `useWorkspaceUsage` returns it and the pinned
`WorkspaceUsage` alias is gone. A caller who is not a member of the
workspace (including an unknown id, so existence is not revealed, and a call without a JWT) gets
SQLSTATE `42501` `not a member of this workspace`; `anon` gets `42501 permission denied for
function workspace_usage`. Through PostgREST: `supabase.rpc('workspace_usage', { p_workspace_id })`
returns `{ modules, records, members, attachments, storage_bytes }[]` with one element
(`storage_bytes` is a JSON number). The plan-limit check of migration 007 does not call it (it
requires membership, and the enforced counts include pending invitations and in-flight uploads):
it uses `entitlement_usage()`, exposed to the UI as `workspace_entitlements()`; see
[Plans and limits](#plans-and-limits-migration-20261106090000_007_plans_and_entitlementssql).

### Not decided yet (Phase 4)

- Record-level audit beyond deletes (`record.created`, edits) and per-record ownership or a
  read-only role; today every member writes every record and only deletes are logged (006).
- A module-level status list for `records.status` (free text today).
- Enforcing module and record limits before insert: done in migration 007 (`check_entitlement`,
  live counts, contract C6; see [Plans and limits](#plans-and-limits-migration-20261106090000_007_plans_and_entitlementssql)).

## Attachments (migration `20261104090000_005_attachments.sql`)

Applied 2026-11-04 (Part 13, story B4). A file on a record is one `attachments` row plus one object
in the private Storage bucket `attachments`. Migration 005 also adds the unique constraint
`records_id_workspace_id_key (id, workspace_id)`, the target of the composite foreign key below.

### `attachments`

| Column         | Type        | Notes                                                                       |
| -------------- | ----------- | --------------------------------------------------------------------------- |
| `id`           | uuid PK     | default `gen_random_uuid()`; **not insertable** by clients                  |
| `workspace_id` | uuid        | not null, `references workspaces on delete cascade`; `attachments_workspace_id_idx` |
| `record_id`    | uuid        | not null; `attachments_record_workspace_fkey (record_id, workspace_id) references records (id, workspace_id) on delete cascade` |
| `file_name`    | text        | not null, `attachments_file_name_check` (`attachment_file_name_is_valid`): 1..255 chars, no leading/trailing whitespace, only `A-Z a-z 0-9`, space and `! - . _ * ' ( ) & $ @ = ; : + , ?` (the characters Supabase Storage accepts in a key; so never `/`, `\`, control characters or non-ASCII letters) |
| `content_type` | text        | not null, `attachments_content_type_check`: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`, `text/csv`, docx, xlsx, pptx (`application/vnd.openxmlformats-officedocument.*`), `application/zip`; the bare type, no parameters |
| `size_bytes`   | bigint      | not null, `attachments_size_bytes_check` 1..10,485,760 (10 MB, hypothesis)  |
| `storage_path` | text        | not null, unique; **generated always** as `workspace_id || '/' || record_id || '/' || id || '-' || file_name` stored; a supplied value fails with `428C9` |
| `uploaded_by`  | uuid        | default `auth.uid()`, `references auth.users on delete set null`; **not insertable** (always the caller) |
| `created_at`   | timestamptz | default `now()`; not insertable                                              |
| `uploaded_at`  | timestamptz | (006) null while pending; set by `reconcile_attachment_object()` when the matching object is stored; read-only for clients. Index `attachments_pending_created_idx (created_at) where uploaded_at is null` |

Since migration 006 `file_name` also has `attachments_file_name_url_safe_check`
(`file_name !~ '[?#%]'`): `?`, `#` and `%` broke object URLs (code review 2). The frontend
sanitiser replaces them.

Indexes: `attachments_record_created_idx (record_id, created_at)` for the record page,
`attachments_workspace_id_idx`, the unique index on `storage_path`. No `updated_at`: an
attachment is immutable (no update grant, no update policy; to rename, delete and upload again).
The task asked for `storage_path` "set by a before-insert trigger"; a generated column gives the
same guarantee (derived from the other columns and `id`, never client-chosen) without a trigger.

Rules and errors (all `23514` unless noted):

| Error                                               | When                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| constraint `attachments_file_name_check`            | name empty, > 255, padded, or with a character outside the set above |
| constraint `attachments_content_type_check`         | MIME type outside the allow-list (also `text/plain; charset=utf-8`) |
| constraint `attachments_size_bytes_check`           | size 0 or > 10 MB                                                 |
| constraint `attachments_file_name_url_safe_check`   | (006) name contains `?`, `#` or `%`                               |
| message `attachments: at most 10 files per record`  | 11th row on one record (`enforce_attachment_cap()`, per-record advisory lock so parallel inserts cannot both pass at 9). Since 006 the count is uploaded rows plus pending rows younger than one hour: a stale pending row does not block a slot |
| `23503` `attachments_record_workspace_fkey`         | `record_id` is not a record of `workspace_id` (another workspace's record) |
| `42501` new row violates row-level security          | `workspace_id` is not a workspace of the caller                    |
| `42501` permission denied for table attachments      | the insert names `id`, `uploaded_by` or `created_at`; any update  |

Audit: `attachment.added` (insert) and `attachment.removed` (direct delete) with metadata exactly
`{ record_id, file_name, size_bytes }` and the caller as `actor_id`; no path, MIME type or
content. Attachments removed by a record, module or workspace cascade are not logged per file
(`record.deleted` carries `attachment_count` since 006). A reconciliation rejection writes
`attachment.rejected` instead.

Plan limits (Phase 4): the row insert is the single creation path, so `check_entitlement` for
`attachments` and `storage_bytes` attaches to it as a before-insert trigger; downloads keep working
when a workspace is over its storage limit.

Deviation from the B4 allow-list hypothesis (pdf, png, jpg, jpeg, webp, heic, csv, xlsx, docx):
Part 13 ships png, jpeg, gif, webp, pdf, plain text, csv, docx, xlsx, pptx and zip; `heic` is not
included (browsers do not render it). Adding a type is a new migration that updates both
`attachment_content_type_is_allowed()` and the bucket.

### Bucket `attachments`

Created by the migration with `insert into storage.buckets ... on conflict (id) do nothing`:
`public = false` (no public URL; `/object/public/...` answers 400), `file_size_limit = 10485760`,
`allowed_mime_types` = the same eleven types as `attachments_content_type_check` (the test
`20_storage_policies.sql` asserts both lists agree). Object names are
`<workspace_id>/<record_id>/<attachment_id>-<file_name>`, exactly `attachments.storage_path`.

### Storage policies

How Storage evaluates them (verified on CLI 2.122, storage-api 1.84.19, re-checked 2026-11-04
for migration 006 by logging every `storage.objects` insert): for a normal upload (multipart or
TUS with the user's JWT) storage-api first runs a permission test as the caller (`authenticated`,
`request.jwt.claims` set): it inserts the row with metadata `{ mimetype, contentLength }`
(`contentLength` is the **request** size for multipart uploads, not the file size) and rolls it
back. After the bytes are stored it runs the same test again with the backend metadata (`size`,
`mimetype`, `eTag`, ...) and then inserts the real row **as its superuser role** (current user
`postgres`, RLS bypassed). None of these inserts uses `RETURNING` and existing objects are looked up
as the superuser, so uploads need no select policy (migration 006 removed it; supabase-js
`upload` and TUS uploads verified). Downloads, signed-URL creation and listing are selects;
removal is `delete ... returning`. `owner` / `owner_id` are set to the uploader but are not used
for authorization: the `attachments` row is the source of truth.

**Signed upload URLs bypass RLS.** `POST /object/upload/sign/<bucket>/<path>` runs the permission
test once with metadata from the *sign request's* headers, and the later
`PUT /object/upload/sign/...?token=` (and TUS `POST /upload/resumable/sign` with `x-signature`)
writes the object entirely as the superuser. The insert policy therefore never sees the real
size or type of such an upload (review finding H1: a 1-byte `text/plain` row received a 10 MiB
zip). Migration 006 closes this with `reconcile_attachment_object()`, an after insert/update
trigger on `storage.objects` that compares every stored object with its row, whoever wrote it.

Policies on `storage.objects` since migration 006: exactly one, `bucket_id = 'attachments' and
<helper>`, calling a security definer helper (no inline membership subquery):

| Command | Policy                                              | Helper and rule                                                                 |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| select  | none (006)                                          | nobody lists, downloads or signs directly; downloads go through `attachment-url` (C1) |
| insert  | `attachments_objects_insert_uploader`               | `can_upload_attachment_object(name, metadata)`: metadata present with a `mimetype` (parameters such as `;charset=` ignored) equal to `content_type`; when `size` is present it equals `size_bytes`; the row is pending (`uploaded_at is null`) and younger than one hour, `uploaded_by = auth.uid()` and the caller is still a member; no object exists under the name yet |
| update  | none                                                | objects are immutable: `x-upsert: true`, move and copy are refused              |
| delete  | none (006)                                          | removal is the row delete (C2): the queue trigger enqueues the object and `purge-attachments` removes it |

Because `storage_path` is generated from `workspace_id`, `record_id` and `id`, the equality
`storage_path = name` also proves that the first path segment is the row's workspace and the
second its record, and the composite foreign key ties that record to the same workspace; no
`storage.foldername(name)` parsing is needed. Deliberate differences from the B4 text: only the
**uploader** may upload the bytes for a row (an owner cannot fill someone else's pending row), a
row can be uploaded once (`uploaded_at`), and no client reads or removes objects directly.

Reconciliation (`attachments_reconcile_object`, every insert or metadata update in the bucket
whose metadata carries `size`; the size-less permission tests are left to the policy):

| Situation | Effect |
| --------- | ------ |
| row found, `size` = `size_bytes`, MIME type = `content_type`, fewer than 10 other uploaded rows on the record | `uploaded_at = now()` |
| size differs / MIME type differs / record already has 10 uploaded files | row deleted (object queued by the delete trigger), `attachment.rejected` with `reason` `size_mismatch` / `content_type_mismatch` / `too_many_files`, actor = the row's uploader; no `attachment.removed` |
| no row with `storage_path = name` (row deleted while the upload ran, or a superuser write) | object queued in `storage_deletion_queue` (workspace from the first path segment) |

The rejected object stays in `storage.objects` until the next purge, unreachable for clients
(no select policy, no row for `attachment-url`).

HTTP results against the local stack (2026-11-04, migration 006). Storage answers policy denials
with HTTP **400** (or 403 on the TUS endpoint) and the logical status in the JSON body
(`statusCode`); clients should switch on the body:

| Request                                                             | HTTP | body `statusCode` / result      |
| ------------------------------------------------------------------- | ---: | ------------------------------- |
| alice uploads to her row's `storage_path` (supabase-js `upload`)    |  200 | `uploaded_at` set               |
| alice: TUS upload with her JWT, matching file                       | 201 / 204 | `uploaded_at` set          |
| alice: TUS upload with her JWT, 10 MiB for a 1-byte row             | 201 / 403 | nothing stored             |
| alice: sign upload (`content-type: text/plain`) + `PUT` 10 MiB zip for a 1-byte `text/plain` row | 200 / 200 | object stored by the superuser, then reconciled: row deleted, `attachment.rejected` `size_mismatch`, object queued and purged |
| same through TUS `/upload/resumable/sign` with `x-signature`         | 201 / 204 | reconciled the same way    |
| alice `createSignedUrl`, `download`, `list` on the bucket           |  400 | `404` / `Object not found`; `list` returns `[]` |
| alice `remove([own path])`                                          |  200 | `[]` (nothing removed)          |
| alice uploads to a path without a row, or under B's prefix          |  400 | `403` `Unauthorized`            |
| alice uploads again to the same path (`x-upsert: true` or not)      |  400 | `403` `Unauthorized`            |
| upload whose size or MIME type differs from the row                 |  400 | `403` `Unauthorized`            |
| upload with a MIME type outside the bucket list                     |  400 | `415` `invalid_mime_type`       |
| public URL of the object                                            |  400 |                                 |

### Cleanup of storage objects (`storage_deletion_queue`, `purge-attachments`)

Postgres cannot call the Storage API. Deleting from `storage.objects` in SQL is not an option:
storage-api 1.84 installs `storage.protect_delete()`, which refuses direct deletes (`42501 Direct
deletion from storage tables is not allowed`), and with its override
(`storage.allow_delete_query = 'true'`) the row disappears but the file stays in the backing
store (verified 2026-11-04 on the local file backend). Approach (a) is therefore implemented:

1. `enqueue_attachment_object_deletion()` (after delete on `attachments`) inserts
   `(bucket_id 'attachments', object_name = storage_path, workspace_id)` into
   `public.storage_deletion_queue` for every deleted row: a direct delete, or a cascade from a
   record, module or workspace delete. Queue rows carry `workspace_id` without a foreign key so
   they survive the workspace delete that produced them (the one documented exception to the
   "`workspace_id references workspaces`" rule; the table is system-owned, not tenant data).
2. The Edge Function `purge-attachments` (service-role key only) removes queued objects through
   the Storage API in chunks of 100 names and deletes the queue rows; a failed chunk increments
   `attempts` (entries stop being retried after 10) and keeps `last_error` without stopping the
   other chunks. Removing an object that is already gone is not an error (`alreadyGone`).
   Migration 006 also queues objects from reconciliation (rejections, objects without a row).
3. Schedule (migration 006): pg_cron job `purge-attachments` every 10 minutes, created only when
   the Vault secrets exist; see [Schedule](#schedule-pg_cron--pg_net--vault).

`storage_deletion_queue` columns: `id` bigint identity, `bucket_id`, `object_name`,
`workspace_id`, `enqueued_at`, `attempts`, `last_error` (<= 500), `last_attempt_at`. RLS enabled,
no policies, no grants for `anon` or `authenticated`; only `service_role` reads and writes it.
Between the row delete and the purge an orphaned object is unreachable for clients (no select
policy at all since 006). The reverse orphan, a row whose upload never happened, stays pending
(`uploaded_at` null: no download, not in `storage_bytes`, no cap slot after one hour) and is
deleted by `sweep_stale_attachments()` one hour after its insert (pg_cron job
`sweep-stale-attachments`).

## Phase 3 review fixes (migration `20261105090000_006_phase3_review_fixes.sql`)

Applied 2026-11-04 (Part 17a) after the Phase 3 code and security reviews. Migrations 004 and
005 are untouched; every change is a new constraint, column, index, trigger, function, grant, or
a `create or replace` / drop of a 004/005 object. Tests: `supabase/tests/21_phase3_fixes.sql`
(plus updated `01`, `10`, `17`, `18`, `19`, `20`); HTTP checks listed under each contract.

| # | Finding | Fix |
| - | ------- | --- |
| H1 | Signed upload URLs (and signed TUS) bypass the size/type check: the final write is the storage superuser | `reconcile_attachment_object()` trigger on `storage.objects`; policy requires metadata and mimetype |
| H2 | `purge-attachments` stalled: the live-row `in()` filter overflowed the URL for long names and threw | live-row check removed (cannot match, see the function), chunked removes, per-chunk failure bookkeeping, result `{ purged, alreadyGone, retryable, dead }` |
| M3 | Numbers of any magnitude and precision | `custom_values.<key>: number out of range` (`abs(x) >= 1e15` or > 6 decimals) |
| L1 | CSV formula guard only looked at the first character | guard after leading (Unicode) whitespace and quote characters, fullwidth `＝ ＋ － ＠` |
| L3 | Clients could choose primary keys of modules, fields, records | `id` removed from the insert grants |
| L4 | Unbounded `settings` / `options` | `pg_column_size` checks 2048 / 32768 |
| L5 | Pending rows (upload never happened) counted in `storage_bytes` and the cap forever | `uploaded_at`, usage and cap ignore stale pending rows, `sweep_stale_attachments()` |
| L6 | Whitespace-only values passed `required` and the title | `text_is_blank()`; `records_title_not_blank_check` |
| L7 | Deep JSON in `custom_values` | objects and arrays rejected first (`nested objects and arrays are not allowed`) |
| CR2 | `?` `#` `%` in file names broke object URLs | `attachments_file_name_url_safe_check` |
| CR5 | Record writes raced field changes; `pg_trigger_depth()` skip too broad; `''` counted as a value in the guards | module row `for share` / `for update`, `app.field_strip` flag, blank values ignored by the guards |
| - | Downloads and deletes by any client against `storage.objects` | C1 `attachment-url`, C2 row-only delete; select/delete storage policies dropped |
| - | Lost updates | C3 `update_record` |
| - | Search missed parts of emails and decimals | C4 tokenizer + search document |
| - | Record deletes were not audited | C5 `record.deleted` |
| - | Default sort without an index | `records_workspace_module_updated_idx` |

### Contract C1: `attachment-url` (download)

`POST /functions/v1/attachment-url`, `verify_jwt = true`, body `{ attachmentId: uuid }`.

- `200 { data: { url: string, expiresAt: string } }`: `url` is an absolute signed Storage URL
  (`<public API origin>/storage/v1/object/sign/attachments/<path>?token=...&download=<file_name>`)
  valid for 60 seconds; Storage answers it with `Content-Disposition: attachment;
  filename=<file_name>`. `expiresAt` is ISO 8601 UTC, computed just before signing (never later
  than the real expiry).
- `401 unauthorized` (no or invalid JWT), `400 validation_error` (body), `404 not_found` with the
  identical body `{ error: { code: "not_found", message: "Attachment not found" } }` when the row
  does not exist, is not visible to the caller (other workspace), is still pending
  (`uploaded_at` null) or its object is missing; `500 internal`.
- The row is loaded with the caller's client (RLS proves membership); only the signing uses the
  service role. Public origin: hosted projects inject the public `SUPABASE_URL`; the local CLI
  runtime injects `http://kong:8000`, so there the origin Kong forwarded (`x-forwarded-host`) is
  used; `PUBLIC_SUPABASE_URL` (function secret) overrides both.
- Verified 2026-11-04: alice 200, `expiresAt` 60 s ahead, the URL downloads identical bytes with
  `Content-Disposition: attachment`; bob 404; random id and pending row: the same 404 body;
  direct `createSignedUrl` / `download` as alice fail (`Object not found`).

### Contract C2: attachment delete and storage access

The client deletes only the row: `from('attachments').delete().eq('id', id).select('id')`; zero
rows means not allowed or already gone. `enqueue_attachment_object_deletion()` queues the object
and `purge-attachments` removes it. Clients do not call `storage.remove` (it would remove nothing:
there is no delete policy) and cannot select objects (no select policy), so no client can list,
download or sign. Uploads are unchanged (insert row, then `storage.upload(storage_path, ...)`) and
verified to work without a select policy, so no time-boxed select policy was needed.

### `update_record` (contract C3)

`public.update_record(p_record_id uuid, p_expected_updated_at timestamptz, p_patch jsonb)
returns public.records`, security invoker (RLS applies), `set search_path = ''`, execute granted
to `authenticated` only. Through PostgREST:
`supabase.rpc('update_record', { p_record_id, p_expected_updated_at, p_patch })` (add
`.select('...')` to choose columns; the default row includes `search_vector`).

`p_patch` keys, all optional: `title` (string), `status` (string, or `null` to clear), `set`
(object of custom values to set), `unset` (array of keys to remove). Statement:
`update records set title = coalesce(p_patch->>'title', title), status = case when p_patch ?
'status' then p_patch->>'status' else status end, custom_values = (custom_values - unset) || set
where id = p_record_id and updated_at = p_expected_updated_at returning *`. `unset` is applied
before `set` (a key in both ends up set). When the patch has neither `set` nor `unset`,
`custom_values` is left out of the SET list, so the validation trigger does not run and a
title/status edit of a stale record still succeeds (as with a direct title-only update).

| SQLSTATE / HTTP | Message | When |
| --------------- | ------- | ---- |
| `PT409` / 409 | `record_changed` | zero rows updated and the record exists and is visible: someone changed it since `p_expected_updated_at` (hint: reload and apply again) |
| `PT404` / 404 | `not_found` | zero rows and the record does not exist or is not visible (other workspace: same answer) |
| `23514` / 400 | `custom_values.<key>: <reason>` or the title check | validation on the merged value, unchanged contract |
| `22023` / 400 | `p_patch: expected object`, `p_patch.<key>: unknown key`, `p_patch.title: expected string`, `p_patch.status: expected string or null`, `p_patch.set: expected object`, `p_patch.unset: expected array of strings` | malformed patch |

`p_expected_updated_at` must be the `updated_at` exactly as read (microsecond precision): send the
string PostgREST returned, not a value round-tripped through a JavaScript `Date` (milliseconds
only), or every call answers `record_changed`. Verified 2026-11-04 over PostgREST: two calls with
the same expected timestamp give 200 then 409 `PT409 record_changed`; bob gets 404 `PT404`.

### Search tokenizer and document (contract C4)

Tokenizer (identical in `src/features/records/lib/records-filters.ts` and
`supabase/functions/_shared/search.ts`, used by `export-records`): NFC-normalise; split on
whitespace and on every character that is not a letter, mark, digit or one of `. @ - _ +`; strip
leading and trailing `. @ - _ +` from each token; drop empty tokens; lowercase; dedupe; keep at
most 8; each token becomes `token:*`; join with ` & `. No token: `title ilike %term%` (backslash,
`%`, `_` escaped). The surviving characters have no tsquery meaning, so input cannot form
operators.

Document: `record_search_document(title, status, custom_values)` indexes the text three times:
as written (the `simple` parser keeps emails, hosts, decimals, signed integers and hyphenated
words whole), with `@` replaced by a space (the domain of an email becomes a host), and with
every run of non-alphanumeric, non-space characters replaced by a space. Examples:
`jane@acme.example` -> `jane@acme.example`, `acme.example`, `jane`, `acme`, `example`; `12500.5`
-> `12500.5`, `12500`, `5`; `ops@example.com` -> also `example.com`. Each copy keeps consecutive
positions, so the phrase query `to_tsquery` builds for a multi-part token (`foo-bar`, `a_b`)
still matches. Tested queries (`21_phase3_fixes.sql`): `12500.5`, `12500`, `acme` (email value),
`jane@acme.example`, `jane@acme`, `example.com`, `-5` (-> `5:*`), `café`, `ACME`. Known gap:
`example.com` does not find `www.example.com` (one host lexeme).

### `record.deleted` (contract C5)

Written by `audit_record_delete()`, a **before** delete row trigger on `records`: `action
'record.deleted'`, `entity_type 'record'`, `entity_id` the record id, `actor_id auth.uid()`,
metadata exactly `{ module_id, title, attachment_count }` where `attachment_count` is the number
of attachments rows the cascade is about to remove. Skipped when the module or the workspace no
longer exists (module or workspace cascade; `module.deleted` stands for its records). Deviation
from the "after-delete trigger" wording: the attachments cascade is an after-row RI trigger that
has already removed the attachments when a user after-trigger runs, and a stash between a before
and an after trigger needs per-row session state; a before-row trigger fires only for a row the
statement deletes (after RLS and the row lock, re-checked under concurrent updates) and is
rolled back with the statement on any error, so the audit row exists exactly when the record was
deleted.

### Schedule (pg_cron + pg_net + Vault)

Both extensions are available in the local stack (pg_cron 1.6.4, pg_net 0.20.4) and on hosted
Supabase; migration 006 creates them when available (`pg_cron` in `pg_catalog`, `pg_net` with
schema `extensions`) and calls `schedule_storage_maintenance()`:

| Job | Schedule | Command | Created when |
| --- | -------- | ------- | ------------ |
| `sweep-stale-attachments` | `5-59/10 * * * *` | `select public.sweep_stale_attachments()` | pg_cron exists |
| `purge-attachments` | `*/10 * * * *` | `select public.invoke_purge_attachments()` | the Vault secrets `purge_attachments_service_key` and `purge_attachments_url` both exist |

The key is never in a migration or a job definition: `invoke_purge_attachments()` reads both
secrets from `vault.decrypted_secrets` at run time and calls `net.http_post` with `Authorization:
Bearer <key>` and body `{"limit": 500}` (60 s timeout; responses land in `net._http_response`).
After creating or rotating the secrets run `select public.schedule_storage_maintenance();`
(idempotent; it removes the purge job again when a secret is missing). Setup:
`docs/operations.md`, "Scheduled maintenance". Verified locally 2026-11-04: with both secrets the
job is created and `invoke_purge_attachments()` got `200 {"data":{"purged":0,"alreadyGone":1,
"retryable":0,"dead":0}}`; `db reset` removes the secrets again.

## Plans and limits (migration `20261106090000_007_plans_and_entitlements.sql`)

Applied 2026-11-05 (Part 18a, Phase 4, Epic C). Server-side plan limits: every insert that adds a
member, an invitation, a module, a record, an attachment or a workspace is checked against the
workspace's plan in the same transaction, and refused with contract C6 when it would exceed it.
Downgrades never delete data (rule 9). Billing provider integration waits for decision D3; until
then every subscription is `manual` and operators change plans (`change-plan`, below).

### `plans` (global catalogue, not tenant-owned)

| Column              | Type        | Notes                                                                   |
| ------------------- | ----------- | ----------------------------------------------------------------------- |
| `key`               | text PK     | `^[a-z][a-z0-9_]{1,31}$`: `free`, `pro`, `business`                     |
| `name`              | text        | 1..50 chars                                                             |
| `price_cents`       | integer     | >= 0, per `billing_interval`                                            |
| `currency`          | text        | ISO 4217, default `USD`                                                 |
| `billing_interval`  | text        | `month` or `year`, default `month`                                      |
| `active`            | boolean     | false: no new subscriptions (`change_workspace_plan` refuses it); existing ones keep its limits |
| `position`          | integer     | display order                                                           |
| `max_workspaces`    | integer     | workspaces a user may own (rule below)                                  |
| `max_members`       | integer     | memberships + pending invitations per workspace                         |
| `max_modules`       | integer     | modules per workspace                                                   |
| `max_records`       | integer     | records per workspace (all modules)                                     |
| `max_storage_bytes` | bigint      | declared attachment bytes per workspace                                 |
| `created_at`, `updated_at` | timestamptz | `updated_at` by `set_updated_at()`                             |

Seeded by the migration (PLANNING section 8; binary units, as for the 10 MB file cap):

| key        | name     | price_cents | workspaces | members | modules | records | storage bytes            |
| ---------- | -------- | ----------: | ---------: | ------: | ------: | ------: | -----------------------: |
| `free`     | Free     |           0 |          1 |       2 |       1 |     200 |  52428800 (50 MB)        |
| `pro`      | Pro      |         900 |          1 |       5 |       5 |   5,000 |  1073741824 (1 GB)       |
| `business` | Business |        2900 |          3 |      20 |      20 |  50,000 |  10737418240 (10 GB)     |

Attachments per record stay capped at 10 by `enforce_attachment_cap()` (005/006), independent
of the plan. Limits are columns, not jsonb: typed, checkable and directly comparable in SQL.

### `subscriptions` (one per workspace)

| Column                     | Type                  | Notes                                                    |
| -------------------------- | --------------------- | -------------------------------------------------------- |
| `id`                       | uuid PK               | `gen_random_uuid()`                                      |
| `workspace_id`             | uuid, unique          | FK `workspaces` on delete cascade; the unique index is its index |
| `plan_key`                 | text                  | FK `plans(key)`, default `free`                          |
| `status`                   | `subscription_status` | `active` / `past_due` / `canceled`, default `active`     |
| `provider`                 | text                  | `manual` only (check), until D3                          |
| `provider_customer_id`, `provider_subscription_id` | text | nullable, 1..255                                |
| `current_period_end`       | timestamptz           | nullable (manual plans have none)                        |
| `created_by`               | uuid                  | default `auth.uid()`; the workspace creator              |
| `created_at`, `updated_at` | timestamptz           | `updated_at` by `set_updated_at()`                       |

Created on Free / `active` / `manual` by the after-insert trigger `workspaces_create_subscription`
(`handle_workspace_subscription()`) in the workspace's own transaction; the migration backfilled
every existing workspace the same way (a workspace already above a Free limit kept everything).
**Effective plan** (`workspace_effective_plan()`): the subscription's plan while `status` is
`active` or `past_due` (grace), Free when `canceled` or when no row exists.

Audit (`subscriptions_audit`, `audit_subscription_change()`): every update that changes
`plan_key` writes `subscription.plan_changed` `{ from, to }`; a status change writes
`subscription.status_changed` `{ from, to }`. This covers every path (the function below, Studio,
psql). Actor: `auth.uid()`, else the transaction-local `app.audit_actor_id` set by
`change_workspace_plan(..., p_actor_id)`, else null (operator). Subscription creation is not
audited separately: `workspace.created` stands for it.

### Entitlements: a function over live counts, not a table

There is no `entitlements` table and no `usage_counters` table. The limits are the effective
plan's columns; usage is counted live inside the inserting transaction by
`entitlement_usage(workspace_id, resource)`:

| Resource        | Counted as                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `members`       | `workspace_members` rows + pending invitations (`accepted_at is null and expires_at > now()`)  |
| `modules`       | `modules` rows                                                                                 |
| `records`       | `records` rows (all modules)                                                                   |
| `storage_bytes` | sum of `attachments.size_bytes` of uploaded rows and of rows still in flight (pending, younger than one hour: the window of the per-record cap) |

Why: live counts cannot drift. Every delete path frees capacity with no counter to keep in step:
record delete, module delete (records and attachments cascade), workspace delete, attachment row
delete, reconciliation rejection, `sweep_stale_attachments()` and stale pending rows (> 1 hour,
not counted), member removal, account deletion, invitation revoke, and invitation expiry (an
expired invitation simply stops counting). The counts use the `workspace_id` indexes; at the
Business ceiling (50,000 records) a count is a few milliseconds. A counter table becomes worth
its triggers only if insert latency at that size matters (revisit in Phase 5).

`workspace_usage()` (004/005/006) is unchanged and still serves the usage badges. It is not
reused by the check because it requires the caller to be a member (an invitee accepting an
invitation is not one yet) and its numbers intentionally differ: its `members` excludes pending
invitations and its `storage_bytes` counts uploaded rows only. The usage page should read
`workspace_entitlements()` for "N of M" so the numbers match what the check enforces.

### `workspace_entitlements(p_workspace_id uuid)`

`security definer`, `stable`, executable by `authenticated` only; the caller must be a member
(else `42501 not a member of this workspace`, also for unknown ids). Returns five rows in this
order: `(resource text, plan text, limit_value bigint, current_value bigint, over_limit boolean)`
for `members`, `modules`, `records`, `storage_bytes` (effective plan of the workspace, enforced
usage) and `workspaces`, which is about the **caller**: workspaces they own vs. may own, with the
plan granting it. `over_limit` is `current_value > limit_value` (e.g. after a downgrade); "at the
limit" is `current_value >= limit_value`. Through PostgREST:
`supabase.rpc('workspace_entitlements', { p_workspace_id })`. Type: `WorkspaceEntitlementRow` in
`src/types/database.ts`.

### `check_entitlement(p_workspace_id uuid, p_resource text, p_delta bigint default 1)`

`security definer`, volatile, executable by no API role (called from the insert triggers). For
`members`, `modules`, `records` or `storage_bytes` (anything else: `22023`):

1. returns at once when `entitlement_check_bypassed()` (below);
2. takes `pg_advisory_xact_lock(hashtext('entitlement:<resource>:<workspace_id>'))`, so two
   transactions cannot both take the last slot (same pattern as the attachment cap of 006; the
   loser waits and then counts the winner's row);
3. reads the effective plan and the live usage (fresh snapshot: the function is volatile);
4. raises contract C6 when `current + p_delta > limit`.

A multi-row insert sees its own earlier rows, so it is refused as a whole once one row crosses
the limit. `check_workspace_entitlement(p_owner_id)` does the same for workspace creation with a
per-user lock `entitlement:workspaces:<user_id>`.

Insert triggers (before insert, named `*_check_entitlement` so they fire before the other
before-insert triggers, i.e. the entitlement lock is taken before the per-record attachment lock
and the module row lock):

| Trigger | Function | Check |
| ------- | -------- | ----- |
| `workspaces_check_entitlement` | `enforce_workspace_entitlement()` | `check_workspace_entitlement(created_by)` |
| `workspace_members_check_entitlement` | `enforce_entitlement()` | `members`, delta 0 when a pending invitation for the joining user's email exists, else 1 |
| `invitations_check_entitlement` | `enforce_entitlement()` | `members`, delta 1 |
| `modules_check_entitlement` | `enforce_entitlement()` | `modules`, delta 1 |
| `records_check_entitlement` | `enforce_entitlement()` | `records`, delta 1 |
| `attachments_check_entitlement` | `enforce_entitlement()` | `storage_bytes`, delta = declared `size_bytes` |

RLS evaluates an insert's `with check` after the before triggers. So that the error never
reveals another workspace's plan or usage (and a permission problem is reported as one), the
trigger skips the check when a signed-in caller would be refused by the insert policy anyway:
not a member of the workspace, or, for `invitations` and `modules`, not an owner or admin; for
`workspaces`, a `created_by` other than the caller. RLS then answers `42501`. Updates and deletes
are never checked.

### Rules

- **Workspace count.** A user's *owned* workspaces are those where they hold the `owner` role.
  The *allowed* count is the highest `max_workspaces` among the effective plans of the workspaces
  they own; Free (1) when they own none. Creating a workspace is refused when owned + 1 > allowed.
  With today's catalogue: owning one Business workspace allows three (the others start on Free);
  Free and Pro owners own one. The `plan` in the error is the plan granting the allowance.
  Ownership gained by a role change or by succession (`handle_user_deleted()`) is not checked
  (not an insert; rule 9).
- **Invitations reserve seats; acceptance re-checks.** A pending, unexpired invitation counts as
  a member, so inviting is refused when memberships + pending invitations would exceed
  `max_members`. Accepting consumes the reserved seat: the membership insert from
  `accept_invitation()` checks with delta 0, i.e. it succeeds while memberships + pending
  invitations (including this one) are within the limit. After a downgrade between invitation and
  acceptance that leaves the workspace over its member limit, acceptance is refused with C6
  (`accept-invitation` answers 402) and the invitation stays pending; it succeeds again once the
  owner removes members or revokes invitations, or upgrades. Revoking or letting an invitation
  expire frees its seat.
- **Downgrades never delete data.** `change_workspace_plan()` moves a workspace to a lower plan
  even when it is over the new limits and reports `over_limit`. The workspace keeps everything;
  edits and deletes keep working; only new inserts of an over-limit resource are refused (a
  resource still under its limit keeps accepting inserts).
- **Seed and operator bypass.** `entitlement_check_bypassed()` is true when the session is
  `postgres` or `supabase_admin` and has not switched role (`current_setting('role') = 'none'`):
  `supabase db reset` seeding, psql and Studio, pgTAP and e2e fixtures written as postgres.
  Security definer functions do not change the `role` setting, so a user reaching an insert
  through `accept_invitation()` or `handle_new_workspace()` is still checked, and `service_role`
  (Edge Functions, PostgREST with the service key) is always checked. Seed Workspace A is on
  Business, B on Free (at its module limit, 1 of 1).
- **Bulk paths.** Templates create one module (checked once) and its fields (not limited).
  `accept_invitation()` is checked as above. The `postgres` bypass covers seed and fixtures.

### Contract C6: `plan_limit_exceeded`

A refused insert raises SQLSTATE **`PT402`** with message **`plan_limit_exceeded`**, `DETAIL` a
JSON object and a `HINT`:

```json
{ "resource": "records", "limit": 200, "current": 200, "plan": "free" }
```

| Key        | Type   | Meaning                                                                   |
| ---------- | ------ | ------------------------------------------------------------------------- |
| `resource` | string | `members`, `modules`, `records`, `storage_bytes` or `workspaces`          |
| `limit`    | number | the effective plan's limit (`storage_bytes`: bytes)                       |
| `current`  | number | enforced usage before the refused insert (may exceed `limit` after a downgrade) |
| `plan`     | string | effective plan key (`workspaces`: the plan granting the allowance)        |

- **PostgREST** (direct table writes from the browser): HTTP **402**, body
  `{ code: "PT402", message: "plan_limit_exceeded", details: "<the JSON as a string>", hint }`.
  supabase-js exposes it as `PostgrestError` with `code === 'PT402'`; parse `details` with
  `JSON.parse`. Type `PlanLimitDetails` in `src/types/database.ts`.
- **Edge Functions** (`invite-member`, `accept-invitation`): HTTP **402**, envelope
  `{ error: { code: "plan_limit_exceeded", message, details } }` with `details` the parsed
  object; mapped by `planLimitError()` in `_shared/errors.ts`. `export-records` and
  `attachment-url` insert nothing limited and never answer 402.
- Key order inside the DETAIL string is not part of the contract (Postgres orders jsonb keys).

### `change_workspace_plan(p_workspace_id uuid, p_plan_key text, p_actor_id uuid default null)`

`security definer`, executable by `service_role` only. Returns one row
`(workspace_id, from_plan, to_plan, changed, over_limit text[])`. Refuses an unknown or inactive
plan (`22023 unknown_plan`) and an unknown workspace (`PT404 workspace_not_found`). Takes the four
resource locks of the workspace (fixed order: members, modules, records, storage_bytes) so an
insert racing the change is checked against either the old or the new plan; creates the
subscription row if it is missing; sets `plan_key` and `status = 'active'` (a manual plan change
reactivates a `past_due` or `canceled` subscription); `changed` is false (no write, no audit) when
both were already in place. `over_limit` lists the resources whose enforced usage exceeds the new
plan. `p_actor_id` (trusted: only the service role calls it) becomes the audit actor.

### Functions added by migration 007

| Function | Security | Callable by | Purpose |
| -------- | -------- | ----------- | ------- |
| `workspace_entitlements(uuid)` | definer, stable | `authenticated` | limits and enforced usage per resource (above) |
| `change_workspace_plan(uuid, text, uuid)` | definer | `service_role` | operator plan change (above) |
| `check_entitlement(uuid, text, bigint)` | definer, volatile | none (triggers) | C6 check for members, modules, records, storage_bytes |
| `check_workspace_entitlement(uuid)` | definer, volatile | none (trigger) | C6 check for workspace creation |
| `workspace_effective_plan(uuid)` | definer, stable | none | effective plan row |
| `entitlement_usage(uuid, text)` | definer, stable | none | enforced usage of one resource |
| `owned_workspace_allowance(uuid)` | definer, stable | none | `(plan_key, max_workspaces, owned)` for a user |
| `entitlement_check_bypassed()` | invoker, stable | none | postgres / supabase_admin session without SET ROLE |
| `enforce_entitlement()`, `enforce_workspace_entitlement()` | definer | none | insert triggers above |
| `handle_workspace_subscription()`, `audit_subscription_change()` | definer | none | subscription creation and audit triggers |

Tests: `supabase/tests/22_plans_and_entitlements.sql` (structure, catalogue, isolation, every
resource at its limit with the exact DETAIL, frees by delete/revoke/expiry/removal/cascade,
downgrade between invite and accept, over-limit after downgrade, bypass, audit) and case (e) of
`tests/concurrency/concurrency.test.ts` (two sessions racing for the last record slot: one wins,
the loser waited on the advisory lock and gets `PT402`).

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

Plans (migration 007): Workspace A is on Business (the seed moves it once and writes
`subscription.plan_changed`), Workspace B on Free and at its module limit (1 of 1). The pgTAP
include puts both on Business inside each test transaction; `22` tests the limits on its own
workspaces.

Alice is not a member of B and Bob is not a member of A. The seed inserts `auth.users` and
`auth.identities` directly (local only), and inserts the workspaces with `created_by` set so the
`on_workspace_created` trigger produces the memberships and audit rows.

Content (migration 004; `SEED_MODULES`, `SEED_FIELDS`, `SEED_RECORDS` in `tests/fixtures/ids.ts`):

| Entity                         | Id                                     | Details                                                        |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| Module Clients (A)             | `00000000-0000-0000-0000-0000000a0001` | slug `clients`, icon `building-2`, created by alice            |
| Field `company`                | `00000000-0000-0000-0000-0000000f0001` | text, required, position 0                                     |
| Field `contact_email`          | `00000000-0000-0000-0000-0000000f0002` | text, position 1                                               |
| Field `status`                 | `00000000-0000-0000-0000-0000000f0003` | select `lead` / `active` / `churned`, position 2               |
| Field `value`                  | `00000000-0000-0000-0000-0000000f0004` | currency, settings `{ "currency": "EUR", "precision": 2 }`, position 3 |
| Record Acme Ltd                | `00000000-0000-0000-0000-0000000e0001` | status `active`, all four values                               |
| Record Globex Corporation      | `00000000-0000-0000-0000-0000000e0002` | status `lead`, no `value`                                      |
| Record Initech                 | `00000000-0000-0000-0000-0000000e0003` | status `churned`, `value` 0, no `contact_email`                |
| Module Projects (B)            | `00000000-0000-0000-0000-0000000b0001` | slug `projects`, no fields, no records, created by bob         |

The pgTAP tests never rely on these rows (only on the four tenancy facts above); they create
their own modules, fields and records under the `tests.mod_*`, `tests.fld_*` and `tests.rec_*`
ids (`...c0a1`, `...c0f1`, `...c0e1`, ...), which must not be used by manual testing.

## Edge Functions (`supabase/functions`)

Deno functions served by the Supabase edge runtime at `/functions/v1/<name>`. One shared Deno
config, `supabase/functions/deno.json`, holds the import map (`@supabase/supabase-js` 2, `zod` 4)
for every function; the CLI resolves the nearest `deno.json` of each entrypoint and
`config.toml` names it explicitly (`import_map`). `[functions.<name>]` in `config.toml` has
`verify_jwt = true`, so the runtime rejects requests with a missing or invalid JWT before the
function runs; every function still verifies the user itself with `auth.getUser()`.

Order of operations in every function (agent rule): CORS preflight -> verify JWT -> validate the
body with Zod -> load the caller's role in the target workspace -> check business rules -> act ->
audit. Functions never return the service-role key or an invitation token.

### Shared toolkit (`_shared/`)

| Module          | Exports                                                     | Purpose                                                                                     |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `cors.ts`       | `corsHeaders(req)`, `handlePreflight(req)`                  | Allow-list from env `ALLOWED_ORIGIN` (comma-separated, default `http://localhost:5173`).    |
| `errors.ts`     | `AppError`, `ErrorCode`, `jsonOk`, `jsonError`, `toAppError`, `planLimitError`, `PlanLimitDetails` | Envelope `{ data }` or `{ error: { code, message, details? } }`; unknown errors -> `internal`; `planLimitError(pgError)` maps `PT402` to 402 `plan_limit_exceeded` with the parsed C6 detail (007). |
| `handler.ts`    | `createHandler(methods, fn)`                                | Wraps a function with preflight, method check and error mapping.                            |
| `auth.ts`       | `requireUser(req)`, `adminClient()`, `requireWorkspaceRole()`, `requireServiceRole(req)` | User-scoped client (anon key + caller JWT), service-role client, membership/role check; operator-only guard (bearer must equal the service-role or secret key, constant-time compare). |
| `validation.ts` | `parseBody(req, schema)`                                    | JSON body through a Zod schema; failures -> 400 `validation_error` with flattened issues.    |
| `audit.ts`      | `writeAudit(admin, event)`                                  | Inserts an `audit_events` row for writes no trigger covers (`export-records`: `records.exported`). |
| `csv.ts`        | `buildCsv`, `csvPreamble`, `csvRecordRows`, `selectLabelsByKey`, `csvRow`, `quoteField`, `neutralizeFormula`, `formatFieldCell`, `formatNumber`, `formatTimestamp`, `exportFileName`, `CSV_BOM` | Pure CSV helpers for `export-records` (no Deno or Supabase imports); tests in `csv.test.ts`. |
| `search.ts`     | `searchTokens`, `buildPrefixTsQuery`, `MAX_SEARCH_TOKENS`   | The C4 search tokenizer (006); tests in `search.test.ts`.                                    |
| `types.ts`      | `WorkspaceRole`, `WORKSPACE_ROLES`                          | Mirror of the `workspace_role` enum.                                                        |

### Error codes

| HTTP | `error.code`         | Raised when                                                                                    |
| ---: | -------------------- | ---------------------------------------------------------------------------------------------- |
|  400 | `validation_error`   | Body is not JSON or fails the Zod schema; `details` holds `{ formErrors, fieldErrors }`.         |
|  401 | `unauthorized`       | No bearer token, or `auth.getUser()` rejects it. With `verify_jwt = true` the runtime answers a malformed or expired JWT first, with its own body (`{ code: "UNAUTHORIZED_..." }`); clients switch on the status. |
|  403 | `forbidden`          | Caller is not a member, has an insufficient role, an admin invites as owner, or an invitation belongs to a different (or unverified) email. Non-membership and wrong role share one code so workspace existence is not revealed. |
|  404 | `not_found`          | Invitation token unknown or already used; `attachment-url`: attachment absent, not visible, pending or without object (one body). |
|  405 | `method_not_allowed` | Anything but `POST` (and `OPTIONS`).                                                           |
|  409 | `conflict`           | The invited email already belongs to a member of the workspace.                                |
|  410 | `invitation_expired` | `expires_at` has passed.                                                                       |
|  402 | `plan_limit_exceeded` | Contract C6 (migration 007): `invite-member` (memberships + pending invitations at the plan's member limit) or `accept-invitation` (workspace over its member limit, e.g. after a downgrade); `details: { resource, limit, current, plan }`. Mapped from SQLSTATE `PT402` by `planLimitError()`. |
|  413 | `export_too_large`   | `export-records`: more than 50,000 matching rows; `details: { limit: 50000 }`. Filter first.   |
|  500 | `internal`           | Unexpected failure; message is generic, details only in the function log.                      |

### `invite-member` (POST)

Request `{ workspaceId: uuid, email: string, role: 'owner' | 'admin' | 'member' }`; `email` is
trimmed and lowercased, 3..320 chars and must be an email address. Response
`200 { data: { id, email, role, expiresAt } }`. Rules: caller must be owner or admin (`403`);
only an owner may invite as owner (`403`); email already a member -> `409`; a pending, unexpired
invitation for the same email is returned unchanged (`200`, idempotent, same `id`); an expired
pending invitation for the email is deleted first (audited as `invitation.revoked`) and a new
one created (`200`, new `id`). Two concurrent requests for a new email both answer `200` with
the same `id`: the loser's insert hits `invitations_pending_unique` (`23505`) and returns the
winner's row. Since migration 007 the insert is plan-limited: when memberships plus pending
invitations already fill the plan's `max_members`, the trigger raises `PT402` and the function
answers `402 plan_limit_exceeded` (contract C6). The idempotent "existing pending invitation"
answer comes before the insert, so re-inviting a pending address never hits the limit.

The lookups (caller role, current members' emails, pending invitations) use the service-role
client. The expired-row delete and the insert deliberately use the caller's own client: RLS
re-checks owner/admin, `invited_by = auth.uid()` and the owner-only rule as a second line of
defence, and the `invitations_audit` trigger records the caller as `actor_id` (with the
service-role client `auth.uid()` would be null and the actor lost). Nothing is double-logged.

### `accept-invitation` (POST)

Request `{ token: string }`. Response
`200 { data: { workspaceId, workspaceName, workspaceSlug, role } }`. Thin wrapper: verifies the
user, validates the body and calls `accept_invitation(p_token)` through the caller's client, so
`auth.uid()` inside Postgres is the caller and the service-role key is not involved. SQLSTATE
mapping: `PT401` -> 401 `unauthorized`, `PT403`/`42501` -> 403 `forbidden`, `PT404` -> 404
`not_found`, `PT410` -> 410 `invitation_expired`, `PT402` -> 402 `plan_limit_exceeded` (migration 007:
the workspace is over its member limit; the invitation stays pending).

Revoking an invitation needs no function: it is a direct delete under RLS (owner/admin) and the
trigger writes `invitation.revoked`.

### `export-records` (POST, story B5)

Request:

```ts
{
  workspaceId: string            // uuid
  moduleId: string               // uuid
  search?: string                // <= 200 chars; same prefix full-text rules as the records list
  filters?: RecordFilter[]       // <= 50; the frontend's shape (src/features/records/types.ts)
}
type RecordFilter =
  | { kind: 'text'; key: string; value: string }                        // text field
  | { kind: 'options'; key: string; values: string[] }                  // select field
  | { kind: 'boolean'; key: string; value: boolean }                    // checkbox field
  | { kind: 'number-range'; key: string; min: number | null; max: number | null } // number, currency
  | { kind: 'date-range'; key: string; min: string | null; max: string | null }   // date, YYYY-MM-DD
```

Each filter's `key` must be a field of the module and its `kind` must match the field type
(otherwise `400 validation_error`, `details.fieldErrors.filters`). Search and filters are applied
with exactly the PostgREST operators of `src/features/records/lib/records-filters.ts` and the C4
tokenizer (`_shared/search.ts`, migration 006), so the export of a filtered view contains the
rows the table shows (in `created_at, id` order, not the table's sort).

Response `200` with headers `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="<module-slug>-YYYY-MM-DD.csv"` (UTC date),
`Access-Control-Expose-Headers: Content-Disposition`, `Cache-Control: no-store`. The body is not
the `{ data }` envelope; errors are the usual `{ error: { code, message, details? } }` JSON.

CSV format (`_shared/csv.ts`, unit tests in `_shared/csv.test.ts`):

- UTF-8 with BOM (`EF BB BF`), RFC 4180: a field containing `"`, `,`, CR or LF is quoted with
  inner quotes doubled; every row, including the last, ends with CRLF (a line break inside a
  quoted text value is kept as is).
- Header: `Title`, `Record status`, the field labels in `position` order (then `key`), `Created
  at`, `Updated at`. Deleted fields are absent (their keys were stripped from the records).
- Values: text as stored; select the current option label (the stored value when the option was
  removed); checkbox `TRUE` / `FALSE`; number and currency plain decimals with a dot, no
  grouping, no currency symbol, no exponent (`12500.5`, `-42.5`); date `YYYY-MM-DD` as stored;
  `Created at` / `Updated at` ISO 8601 UTC (`2026-11-04T09:30:00.123Z`); missing or mistyped
  values empty.
- Formula injection: every text cell (title, status, text, select label, timestamps) is
  prefixed with `'` when it starts with tab or CR, or when its first character after leading
  whitespace (any Unicode space, NBSP included) and quote characters (`"`, `'`, typographic
  quotes) is `=`, `+`, `-`, `@` or a fullwidth form `＝ ＋ － ＠` (006). Number and currency cells
  are produced from JSON numbers and are exempt, so `-42.5` stays a number.

Rules and order: verify the JWT (`401`), validate the body (`400`), require owner or admin in the
workspace via the service-role membership lookup (`403 forbidden` for `member`, non-members and
unknown workspaces), load the module with the caller's client under RLS bound to `workspace_id`
and `id` (`403 forbidden` with the identical body when it is not in the workspace, so existence is
not revealed), count matching rows with a head count (`413 export_too_large`, `details: { limit:
50000 }`, above 50,000; decided before any byte is sent), then **stream** (migration 006 /
Part 17a): the response starts with the BOM and the header row, then one chunk per keyset page of
1,000 on `(created_at, id)` read with the caller's client (RLS applies; `workspace_id` and
`module_id` are bound in every query); after the last page it writes `records.exported` `{
module_id, row_count, filtered }` (`filtered` = non-empty search or any filter) with `writeAudit`
and the caller as `actor_id`, and closes. The response has no `Content-Length`
(`Transfer-Encoding: chunked`). A failure before streaming returns the usual JSON error; a
failure after the 200 (page read error, more than 50,000 rows appearing during the read, audit
write error) aborts the stream, so the client sees a failed download and no audit row is
written; a client that cancels the download also leaves no audit row. Exports are not metered
and are available on every plan.

Deviations from the B5 text, as specified for Part 13: the header is `Title, Record status,
<labels>, Created at, Updated at` (no `id`, no `created_by` display name), checkbox values are
`TRUE` / `FALSE`, and records are read with the caller's client (RLS) rather than the service
role. Performance on the local stack: 50,000 rows in about 11 s (offset paging took 92 s because
each page re-evaluated RLS for every earlier row; keyset paging is linear). Rate limiting is
Phase 5.

### `purge-attachments` (POST, operators only)

Request `{}` or `{ limit?: 1..1000 }` (default 200), with `Authorization: Bearer <service-role
key>`. Response (since 006) `200 { data: { purged, alreadyGone, retryable, dead } }`:

| Field | Meaning |
| ----- | ------- |
| `purged` | objects this call removed from Storage |
| `alreadyGone` | entries this call processed whose object did not exist (any more) |
| `retryable` | entries left in the queue with `attempts < 10` (beyond `limit`, or failed in this call); call again while `retryable > 0` |
| `dead` | entries with `attempts >= 10`, no longer retried (operator action, `docs/operations.md`) |

Any other bearer (a user JWT, the anon key) gets `403 forbidden`; none gets `401`. It reads the
oldest `limit` queue entries with fewer than 10 attempts, removes the objects with
`storage.from(bucket).remove(names)` in chunks of 100 (a request body, so long names never
overflow a URL), deletes the processed queue rows and, for a failed chunk, increments `attempts`
and stores `last_error` without stopping the other chunks. Migration 005's defensive "live row"
check was removed: `storage_path` embeds the row's primary key, ids are generated by the database
(no client insert grant on `id`) and never reissued, so a queued name cannot belong to a live row
(and the `in()` filter over long names overflowed the request URL, review H2). Verified
2026-11-04: 300 entries with ~330-character names plus 3 real objects drained by one call with
`limit: 500` (`{ purged: 3, alreadyGone: 300, retryable: 0, dead: 0 }`;
`scripts/ci/purge-drain-check.sh`). Idempotent and safe to run concurrently. Not audited: the
deletion it completes was audited as `attachment.removed` / `attachment.rejected` (or is part of
a record, module or workspace delete). Scheduled through pg_cron (migration 006). `verify_jwt =
true` works with the legacy service-role JWT; a hosted project that only has `sb_secret_...` keys
must set `verify_jwt = false` for this function (it checks the key itself).

### `change-plan` (POST, operators only, migration 007)

Request `{ workspaceId: uuid, plan: string }` (`plan` trimmed, lowercased, a plan key), with
`Authorization: Bearer <service-role key>`. Response
`200 { data: { workspaceId, from, to, changed, overLimit } }`. Errors: 401 `unauthorized` (no
bearer), 403 `forbidden` (any other bearer, e.g. a user JWT), 400 `validation_error`
(malformed body; unknown or inactive plan with `details.fieldErrors.plan`), 404 `not_found`
(no such workspace), 500 `internal`. A thin wrapper around `change_workspace_plan()` with the
service-role client; downgrades are allowed when over the limit (nothing is deleted, `overLimit`
lists the resources above the new limits). Audit: the `subscriptions_audit` trigger writes
`subscription.plan_changed { from, to }` (actor null for now), so the function does not call
`writeAudit`. Hook for Part 18c (platform admin web): a `TODO(Part 18c)` in the function marks
where `requireUser` + a platform-admin check replaces `requireServiceRole` and the admin's id is
passed as `p_actor_id`. In `scripts/ci/functions-smoke.sh` (no auth 401, user JWT 403).
Verified by HTTP on 2026-11-05 against the local stack (free -> pro 200 `changed: true`, same
plan `changed: false`, unknown plan 400, unknown workspace 404, pro -> free with three seats in
use 200 `overLimit: ["members"]`; afterwards `invite-member` and `accept-invitation` answered
402 `plan_limit_exceeded` and a direct PostgREST module insert 402 `PT402`).
Local operator procedure: `docs/operations.md`, "Changing a workspace's plan".

### `attachment-url` (POST, migration 006)

Contract C1 above. Order: verify the JWT (`requireUser`), validate `{ attachmentId }` with Zod,
load `id, storage_path, file_name, uploaded_at` with the caller's client (RLS), then
`createSignedUrl(storage_path, 60, { download: file_name })` with the service-role client and
rewrite the origin to the public API origin. Not audited (a read). In `scripts/ci/functions-smoke.sh`
(random id -> 404).

## Frontend (`src/`)

React SPA (Vite, TypeScript strict, React Router 7, TanStack Query 5, React Hook Form + Zod 4,
shadcn/ui on Base UI). Maintained by the `frontend-dev` agent. Part 5 (2026-10-30) added the
authentication screens, the protected routing and the app shell; Part 6 (2026-10-30) added the
workspaces and members features, the workspace context and the workspace-scoped route map,
completing Phase 2. Part 11 (2026-11-04) added the field-type registry and the modules feature
(list, templates, module page with a Fields tab, settings); Part 12 (2026-11-04) added the records
list (search, filters, sort, pagination in the URL), the record form and the record pages; Part 14
(2026-11-04) added attachments on the record page, "Export CSV" and the storage usage badge. The
Phase 3 review fixes (2026-11-04, against migration 006 contracts C1 to C5) moved downloads to the
`attachment-url` function, made attachment deletes row-only, switched record edits to
`update_record` with optimistic concurrency, aligned the search tokenizer with `export-records`
and labelled `record.deleted`.

### Feature layout

```
src/app/
  providers.tsx        QueryClientProvider, <AuthStateSync />, <Toaster /> (sonner)
  router.tsx           createBrowserRouter: the route map below. Pages are `React.lazy` chunks
                       behind a `Suspense` boundary (`FullPageSpinner`); layouts, guards and the
                       workspace provider stay in the main bundle
  navigation.ts        getPrimaryNavItems(workspaceId, role) -> Dashboard, Modules, Members,
                       Workspace settings (owner/admin); settingsNavItems -> Profile
  layouts/             AppLayout (sidebar + header + <Outlet />), SidebarNav, UserMenu, AuthLayout
  pages/               DashboardPage (greeting, ModulesOverview, WorkspaceList, RecentActivity),
                       NotFoundPage
src/features/auth/
  api/                 useSession, useAuthStateSync, useSignIn, useSignUp, useSignOut,
                       useRequestPasswordReset, useUpdatePassword, useResendConfirmation,
                       useExchangeAuthCode; keys.ts (['auth', ...])
  schemas/auth.ts      Zod: signIn, signUp, requestPasswordReset, updatePassword (+ inferred types)
  lib/auth-errors.ts   GoTrue error code/message -> user-facing text (only place that knows them)
  lib/auth-redirects.ts  AUTH_ROUTES, callback URL, getSafeRedirect, local mail inbox URL
  components/          SignInForm, SignUpForm, ForgotPasswordForm, ResetPasswordForm,
                       ProtectedRoute, PublicOnlyRoute, AuthCard, LocalInboxHint
  pages/               SignIn, SignUp, ForgotPassword, ResetPassword, VerifyEmail, AuthCallback
src/features/profile/
  api/                 useProfile (['profile', userId]), useUpdateProfile
  schemas/profile.ts   Zod: fullName 1..100
  lib/                 display-name.ts (name; initials, max 2, from the email local part only),
                       profile-errors.ts (PostgREST codes -> text, shares src/lib/postgrest-errors)
  components/pages/    ProfileForm, ProfileSettingsPage
src/features/workspaces/
  api/                 useWorkspaces(userId) (['workspaces', userId]: workspace_members with
                       workspaces(*) embedded, sorted by name), useWorkspace(id) (['workspace', id]),
                       useCreateWorkspace (insert { name, slug, created_by }; the trigger adds the
                       owner row and audit event), useUpdateWorkspace(id), useDeleteWorkspace,
                       useAuditEvents(workspaceId, limit) (['audit', id, { limit }]); keys.ts
  schemas/workspace.ts Zod: name 1..100 trimmed, slug ^[a-z0-9]+(-[a-z0-9]+)*$ max 60
  lib/                 slug.ts (slugify, SLUG_PATTERN), workspace-errors.ts (23505 -> "slug
                       already taken", 23514, 42501, PGRST116, WorkspaceNotFoundError),
                       workspace-permissions.ts (canManageWorkspace o/a, canDeleteWorkspace owner),
                       workspace-routes.ts (WORKSPACE_ROUTES, swapWorkspaceInPath,
                       routeAfterLeavingWorkspace), workspace-storage.ts (localStorage per user),
                       audit-labels.ts (action -> sentence, actor name or "Someone"; invitation
                       events name the role, never an email: metadata is `invitation_id`, `role`;
                       module.created/updated/deleted and field.created/deleted name the module
                       or field label; record.deleted reads `deleted the record "{title}" (N
                       attachments)` from `{ module_id, title, attachment_count }`)
  context/             workspace-context.ts (WorkspaceContext, useCurrentWorkspace),
                       WorkspaceProvider.tsx
  components/          WorkspaceSwitcher, CreateWorkspaceDialog, CreateWorkspaceForm,
                       WorkspaceSettingsForm, DangerZone, WorkspaceList, RecentActivity
  pages/               RootRedirect, WorkspaceRoute, CreateWorkspacePage, WorkspaceSettingsPage
  types.ts             WorkspaceMembership { workspace, role, joinedAt }, AuditEventWithActor
src/features/members/
  api/                 useMembers(workspaceId) (['members', id]: workspace_members + a second
                       profiles query, owners first), useInvitations(workspaceId, { enabled })
                       (['invitations', id], pending only, never selects token), useInviteMember
                       (functions.invoke('invite-member')), useRevokeInvitation (delete under RLS),
                       useChangeMemberRole (update role, owner only), useRemoveMember (delete:
                       remove or self-leave), useAcceptInvitation(token) (query keyed by token,
                       functions.invoke('accept-invitation'), retry false, gcTime 0); keys.ts
  schemas/invite.ts    Zod: email (shared emailSchema), role enum
  lib/                 member-errors.ts (MemberActionError { code }, parseFunctionError reads
                       `await error.context.json()` of a FunctionsHttpError and falls back to the
                       HTTP status, memberErrorFromPostgrest(error, 'read' | 'write') maps P0001
                       "last owner" -> last_owner and PGRST116 -> forbidden on a write / not_found
                       on a read, getMemberErrorMessage), member-permissions.ts (canInvite, invitableRoles,
                       canChangeRole, canRemoveMember: the policy matrix in TypeScript)
  components/          MembersTable (+ skeleton), MemberActionsMenu (change role / remove / leave
                       with confirm dialog), InviteMemberForm, PendingInvitations
  pages/               MembersPage, AcceptInvitationPage
  types.ts             Member (row + profile), FunctionErrorCode, InviteMemberResult,
                       AcceptInvitationResult
src/features/attachments/
  lib/                 attachment-rules.ts (ALLOWED_CONTENT_TYPES = the 11 types of migration 005,
                       MAX_ATTACHMENT_BYTES 10 MB, MAX_ATTACHMENTS_PER_RECORD 10,
                       EXTENSION_CONTENT_TYPES, ACCEPT_ATTRIBUTE, resolveContentType,
                       sanitiseFileName, validateFile -> too_large | empty | type_not_allowed |
                       too_many), storage-errors.ts (AttachmentError { code }, mapStorageError,
                       mapAttachmentRowError, mapAttachmentFunctionError, getAttachmentErrorMessage),
                       attachment-permissions.ts (canDeleteAttachment: uploader or owner/admin),
                       uploader-name.ts, file-icons.ts
  api/                 keys.ts (['attachments', ws, recordId]); attachment-queries.ts
                       (ATTACHMENT_COLUMNS, fetchAttachments + profiles); attachment-writes.ts
                       (uploadAttachment, downloadAttachment via `attachment-url`, deleteAttachment
                       row-only: the raw sequences, no React); useAttachments, useUploadAttachment
                       (batch + per-file progress, one invalidation per batch),
                       useDownloadAttachment, useDeleteAttachment; invalidate.ts (list + ['usage', ws])
  components/          AttachmentsSection (mounted by RecordDetail), AttachmentList (+ skeleton),
                       AttachmentDropzone, UploadProgressList, DeleteAttachmentDialog,
                       AttachmentFileIcon
  types.ts             AttachmentRow, AttachmentItem (row + uploader profile), UploadProgress
src/features/records/
  fields/              The field-type registry (section below): types.ts (FieldTypeDefinition,
                       FieldInputProps), registry.ts (FIELD_TYPE_REGISTRY, getFieldTypeDefinition,
                       FIELD_TYPE_DEFINITIONS, formatFieldValue), build-record-schema.ts
                       (buildRecordSchema, buildDefaultValues), field-json.ts (getSelectOptions,
                       getFieldSettings, toOptionsJson: the only readers of the JSONB columns),
                       number-input.ts (parseNumberInput, stepForPrecision), inputs/ (one
                       controlled input per type), RecordFieldControl.tsx (label + registry input +
                       error wired to React Hook Form), index.ts
  lib/                 custom-values-errors.ts (parseCustomValuesMessage / parseCustomValuesError
                       for the 23514 `custom_values.<key>: <reason>` messages,
                       describeCustomValuesReason), records-query.ts (URL <-> RecordsQuery:
                       parseRecordsQuery, serialiseRecordsQuery, withFilter, withoutCriteria,
                       nextSort, hasActiveCriteria), records-filters.ts (applyRecordsQuery over a
                       structural builder: search, filters, sort; tokenizeSearch,
                       buildPrefixTsQuery, escapeLike), record-values.ts (compactCustomValues,
                       RecordPatch, buildRecordPatch, isEmptyPatch), record-conflict.ts
                       (isRecordConflict, rebaseFormValues, the conflict copy), record-errors.ts
                       (getRecordErrorMessage, mapRecordSaveError, RecordNotFoundError),
                       filter-labels.ts (chip text), pagination.ts (describePageRange, lastPage),
                       export-records.ts (canExportRecords, buildExportBody,
                       parseContentDispositionFileName, fallbackExportFileName, ExportError,
                       exportErrorFromResponse)
  api/                 keys.ts (['records', ws, moduleId, 'list', query], [..., 'detail', id],
                       ['records', ws, 'counts']); record-queries.ts (fetchRecords, countRecords,
                       fetchRecord, fetchRecordCounts, RECORD_COLUMNS); update-record-rpc.ts
                       (updateRecordRpc: typed wrapper for `rpc('update_record')`); useRecords,
                       useRecord, useRefreshRecord, useRecordCounts, useCreateRecord,
                       useUpdateRecord, useDeleteRecord,
                       invalidate.ts (lists + counts + ['usage', ws]), use-export-records.ts
                       (exportRecords: raw fetch to export-records, useExportRecords)
  schemas/record.ts    buildRecordFormSchema(fields) (title 1..200, status <= 50, custom_values =
                       buildRecordSchema), emptyRecordFormValues, recordToFormValues,
                       toRecordPayload, missingRequiredFields
  hooks/               useRecordsUrlState(fields) (useSearchParams <-> RecordsQuery, replace),
                       useRecordConflict(form, base, loadLatest) (PT409 banner state + rebase)
  components/          RecordsTab (+ RecordsList), RecordsToolbar, filters/ (FILTER_CONTROLS per
                       registry filterKind: Text, Options, Boolean, NumberRange, DateRange),
                       RecordsTable, RecordsTableStates (skeleton, error, "No records yet",
                       "No records match"), RecordsPagination, RecordForm, RecordConflictBanner,
                       DiscardChangesDialog,
                       RecordDetail (+ AttachmentsSection), DeleteRecordDialog, ExportCsvButton
  pages/               NewRecordPage, RecordPage (read / ?edit=1, RecordNotFound), EditRecord
                       (snapshot, patch, reload), RecordPageShell
                       (module + fields loading, breadcrumb)
  types.ts             RecordItem, RecordsQuery, RecordFilter, RecordSort, PageSize, RecordsPage
src/features/modules/
  api/                 keys.ts (['modules', ws], ['module', ws, id], ['fields', ws, moduleId],
                       ['usage', ws]); module-writes.ts (countModules, insertModule, insertField,
                       deleteModuleRow, deleteFieldRow, createModuleWriter: the raw statements, no
                       React); useModules(ws) (position then name, plus a field count per module
                       from a second `field_definitions` select), useModule(ws, id) (maybeSingle:
                       null = not found or hidden), useCreateModule(ws) (count -> position,
                       applyTemplate, invalidates list, usage, record counts, audit),
                       useUpdateModule(ws, id), useDeleteModule(ws) (navigate first, invalidate
                       second; removes the module's records cache, refreshes record counts),
                       useFieldDefinitions(ws, moduleId) (position order), useCreateField,
                       useUpdateField (label, required, options, settings only: never key or
                       type), useDeleteField (also invalidates recordKeys.module(ws, moduleId)),
                       useReorderFields (moveField + one position update per changed row,
                       optimistic), useWorkspaceUsage(ws) (rpc workspace_usage -> WorkspaceUsageRow,
                       EMPTY_WORKSPACE_USAGE fallback)
  schemas/             module.ts (name 1..100, slug as workspaces, description <= 500, icon from
                       MODULE_ICONS or '', templateId), field.ts (label 1..100, key
                       ^[a-z][a-z0-9_]{0,49}$, type from FIELD_TYPES, required, options 1..100
                       with distinct values for select, settings.currency from CURRENCY_CODES,
                       precision 0..6; fieldFormSchema is one flat form refined by type)
  lib/                 module-errors.ts (23505 -> slug or key taken, moduleFieldError -> the slug
                       or name input, getModuleFormErrorMessage; 23514 -> options/settings check
                       or the field guard messages, 42501 -> forbidden, PGRST116/23503 -> not
                       found, ModuleNotFoundError/FieldNotFoundError for zero-row writes),
                       module-permissions.ts (canManageModules o/a), field-key.ts
                       (deriveFieldKey, deriveOptionValue), field-payload.ts (form -> columns,
                       strips options/settings the type does not use), field-summary.ts,
                       module-icons.ts (curated lucide names incl. the seed's building-2),
                       currencies.ts, module-names.ts (uniqueModuleName -> "(2)" suffix),
                       templates.ts (section below)
  components/          ModulesList (+ empty state, skeleton), ModuleCard (field and record
                       counts), ModuleIcon,
                       ModuleUsageBadge, StorageUsageBadge ("12.3 MB used"), ModulesOverview (dashboard
                       card), CreateModuleDialog,
                       CreateModuleForm, TemplatePicker, ModuleSettingsForm, DeleteModuleDialog
                       (+ ModuleDangerZone), FieldsTab, FieldList (+ skeleton), FieldTypeBadge,
                       FieldDialog, FieldForm, SelectOptionsEditor, CurrencySettingsFields,
                       DeleteFieldDialog
  pages/               ModulesPage, ModulePage (tabs), ModuleSettingsPage, ModuleNotFound
  types.ts             ModuleSummary (Module + fieldCount)
src/components/shared/ FullPageSpinner, RouteErrorBoundary, FormTextField, FormSelectField,
                       FormTextareaField, FormCheckboxField, FormServerError, SubmitButton,
                       RoleBadge
src/components/ui/     shadcn/ui (button, card, input, label, field, dropdown-menu, avatar,
                       separator, sheet, sonner, skeleton, dialog, alert-dialog, badge, table,
                       native-select, checkbox, textarea, tabs)
src/lib/supabase.ts    createClient<Database>(anon key, PKCE, detectSessionInUrl: false)
src/lib/               download.ts (triggerDownload via a temporary anchor, saveBlob via an object
                       URL revoked on the next tick), format.ts (formatBytes, 1024-based: "10 MB" =
                       10,485,760 bytes; formatDate/formatDateTime for timestamps; parseIsoDate and
                       formatDateOnly for `YYYY-MM-DD` values, parsed as local calendar dates so
                       they never shift by a day), postgrest-errors.ts (isPostgrestError,
                       isNetworkError), function-errors.ts (readFunctionError: envelope code,
                       HTTP status, network flag of a functions.invoke error), workspace-roles.ts
                       (getRoleLabel)
src/types/database.ts  Row aliases: Profile, Workspace, WorkspaceMember, Invitation, AuditEvent,
                       WorkspaceRole, WORKSPACE_ROLES; migration 004: Module, FieldDefinition,
                       RecordRow (+ Insert/Update), FieldType, FIELD_TYPES, SelectOption,
                       FieldSettings, WorkspaceUsageRow; migration 005: Attachment,
                       AttachmentInsert (the five insertable columns)
src/test/              render.tsx (providers + MemoryRouter), supabase-mock.ts (auth, from, rpc,
                       storage.from, createStorageBucketMock (upload only), functions.invoke),
                       workspace-context.tsx (stubbed WorkspaceProvider value),
                       fields.ts (createTestField, createTestModule, createClientsFields),
                       query-builder-mock.ts (chainable PostgREST builder that records calls),
                       vitest-env.d.ts
```

Rules applied: every feature owns `api/` (hooks), `schemas/`, `lib/` (domain logic, no React),
`components/` and `pages/`. Components never talk to Supabase directly; they call hooks. Error
mapping and validation live in `lib/` and `schemas/` so a future API can replace the Supabase
calls without touching the UI. Forms use `FormTextField` (React Hook Form `useController`,
labelled input, inline `FieldError`, `aria-invalid`/`aria-describedby`) and `FormServerError`
(an always-rendered `role="alert"` live region for server errors).

### Session handling

- `useSession()` reads `['auth', 'session']`: `queryFn` is `supabase.auth.getSession()`
  (`staleTime: Infinity`, no retry). `getSession()` waits for the client to restore the
  persisted session, so the first value is already correct and a refresh never flashes the
  sign-in page: `ProtectedRoute`/`PublicOnlyRoute` render `FullPageSpinner` while `isLoading`.
- `useAuthStateSync()` (mounted once in `AppProviders`) subscribes to
  `supabase.auth.onAuthStateChange` and writes every event's session into the cache. On
  `SIGNED_OUT`, or when a different user signs in, it removes every query whose key does not
  start with `'auth'` so no profile or workspace data survives across users.
- Mutations (`useSignIn`, `useSignUp`, `useSignOut`) also write the cache in `onSuccess` so the
  redirect is immediate. Sign-up passes `options.data.full_name`, which the `handle_new_user`
  trigger copies into `profiles.full_name`. When email confirmation is on, Supabase answers an
  existing email with a user whose `identities` is empty; `useSignUp` turns that into
  `user_already_exists` so the form shows the same message as the unconfirmed flow.
- `useProfile()` keys by `user.id` and passes `skipToken` as `queryFn` until it is known (the
  same pattern disables every workspace-scoped query without a non-null assertion); `useUpdateProfile()`
  sends only `full_name` (the column grant allows `full_name` and `avatar_url`) and updates
  plus invalidates `['profile', userId]`.

### Auth flow and email links

The client uses the PKCE flow with `detectSessionInUrl: false`. Every email link
(`emailRedirectTo` on sign-up and resend, `redirectTo` on password reset) points at
`<origin>/auth/callback`; GoTrue accepts it because it shares the hostname of `site_url`
(`supabase/config.toml`; production hosts must add their origin to the redirect allow-list).
GoTrue redirects to `/auth/callback?code=<pkce code>` or, on failure, appends `error`,
`error_code` and `error_description`.

`AuthCallbackPage` exchanges the code exactly once through `useExchangeAuthCode` (a query keyed
by the code, so StrictMode's double mount cannot redeem it twice). supabase-js remembers that a
verifier belongs to a recovery flow and returns `redirectType: 'recovery'`; the page then
navigates to `/auth/reset-password` (which needs the session the link just created and shows
"link invalid or expired" without one) and otherwise to `/`. Locally
(`enable_confirmations = false`) sign-up signs the user in immediately and emails are captured
by Mailpit at `http://127.0.0.1:54324`; the verify-email and forgot-password pages show that
URL in development.

### Workspace context

`WorkspaceProvider` (mounted once, inside `ProtectedRoute` around `AppLayout`) owns the current
workspace. It reads `useWorkspaces(user.id)`, remembers the selection in localStorage under
`fleximanage.currentWorkspace.<userId>` (so two accounts in one browser never share a choice),
defaults to the first workspace by name and falls back to the first remaining one when the
selected workspace disappears (left or deleted). `useCurrentWorkspace()` exposes
`{ workspaces, workspace, role, workspaceId, setWorkspaceId, isLoading, isError, refetch }`.
The selection is derived during render (no setState in effects); the only effect persists the
effective choice to storage. The context value is memoised on `refetch`, `isPending`, `isError`
and `error` (not on the query result object), so consumers do not re-render on every fetch tick.

Deleting or leaving the current workspace navigates first and refetches second: `DangerZone`
and `MemberActionsMenu` go to `routeAfterLeavingWorkspace(workspaces, id)` (the first remaining
workspace's dashboard, else `/workspaces/new`) computed from the list already in hand, and
`useDeleteWorkspace` / `useRemoveMember` invalidate the workspace list without awaiting it, so
`WorkspaceRoute` never flashes "Workspace not found" for the workspace that was just left.

Workspace pages live under `/w/:workspaceId`. `WorkspaceRoute` makes the URL the source of
truth: it calls `setWorkspaceId(param)` when the user is a member, renders a "Workspace not
found" page (404 copy, link to `/`) when not, and only renders the child page once the provider
agrees with the URL, so `useCurrentWorkspace()` in a page always matches the address bar.
`RootRedirect` sends `/` to `/w/<current>` or, for a user with no workspace, to
`/workspaces/new`. The switcher keeps the sub-page when switching (`swapWorkspaceInPath`:
`/w/A/members` -> `/w/B/members`). Nav links are built from the current workspace id
(`getPrimaryNavItems`); "Workspace settings" is listed for owners and admins only.

Permission helpers (`workspace-permissions.ts`, `member-permissions.ts`) mirror the policy
matrix above and are used only to hide controls: owners change roles; owners and admins invite
and remove (admins not owners); anyone may leave; only an owner may grant the owner role or
delete the workspace. Every write still goes through RLS, the last-owner trigger or the Edge
Functions, and the mapped error (`last_owner`, `forbidden`, ...) is shown as a toast or inline.

Writes that RLS filters to zero rows produce no Postgres error, so the delete hooks ask for the
affected ids (`.select('id')`) and throw `WorkspaceNotFoundError` / `MemberActionError('forbidden')`
when nothing came back; single-row updates use `.single()` so the zero-row case surfaces as
`PGRST116`, which `memberErrorFromPostgrest(error, 'write')` reports as `forbidden` (the row
exists; the caller may not change it), keeping `not_found` for genuine by-id read misses.
`workspace_members.user_id` and `audit_events.actor_id` reference `auth.users`, not
`profiles`, so `useMembers` and `useAuditEvents` load the visible profiles in a second query
(`.in('id', ...)`), falling back to "Someone" when RLS hides an actor.

### Invite acceptance (UI side)

1. Owner/admin submits `InviteMemberForm` on `/w/:id/members`; `useInviteMember` calls
   `functions.invoke('invite-member', { body: { workspaceId, email, role } })`. A
   `FunctionsHttpError` is turned into `MemberActionError` by reading
   `await error.context.json()` (`error.code`), falling back to the HTTP status for bodies that
   are not the project envelope (the edge runtime's own 401). `conflict` -> "already a member",
   `forbidden`, `validation_error`, `unauthorized`, `internal` each have one message in
   `member-errors.ts`. The pending list refetches; no email is sent yet (Phase 4 follow-up) and
   the form says "Email delivery is not set up yet. The invitee can join once invitation emails
   are enabled." Locally the token is read from the database (`docs/operations.md`).
2. The invitee opens `/invite/<token>`. The route is protected, so a signed-out user is sent to
   `/auth/sign-in?redirectTo=%2Finvite%2F<token>` and returns to it after signing in. The
   sign-in and sign-up pages keep `?redirectTo` on their cross-links, so an invitee who first
   has to create an account still lands on the invite.
3. `AcceptInvitationPage` runs `useAcceptInvitation(token)`: a query keyed by the token (not a
   mutation in an effect), so StrictMode's double mount cannot redeem the token twice;
   `retry: false` because every error is final; `gcTime: 0` drops the result when the page
   unmounts, so reopening the link in the same session asks the server again (and gets the
   404 copy) instead of replaying the success. The query refetches the workspace list before
   resolving, then the page calls `setWorkspaceId(workspaceId)`, toasts "Joined <name>" and
   navigates to `/w/<workspaceId>`. `not_found` (404) -> "This invitation is no longer valid",
   `invitation_expired` (410) -> "has expired", `forbidden` (403) -> "sent to a different email
   address; sign in with that account"; every error state offers "Go to my workspaces".
4. Revoking is a direct delete under RLS (`useRevokeInvitation`); the trigger writes
   `invitation.revoked`, which the dashboard's "Recent activity" shows through `audit-labels.ts`.

### Field-type registry (`src/features/records/fields/`)

`FIELD_TYPE_REGISTRY: Record<FieldType, FieldTypeDefinition>` is the single place that knows
the six types. Each definition has `type`, `label`, `description`, `icon` (lucide),
`defaultValue`, `zodSchema(field)`, `formatValue(value, field)`, optional `parseInput` and
`InputComponent`. Components never switch on `field.type`; they call
`getFieldTypeDefinition(type)` (the badge, the type picker, the form control) or
`formatFieldValue(value, field)` (table cells). Each entry also declares its `filterKind`
(`text`, `number-range`, `date-range`, `options`, `boolean`), which picks the records filter
control and the PostgREST operator. Adding a type means one registry entry plus the
database enum value.

- **Stored values** are what `records.custom_values` holds and what the schemas validate: text
  `string` (trimmed, <= 2,000; whitespace-only counts as empty), number and currency `number`
  (finite, `abs(x) < 1e15` and at most 6 fractional digits whatever the precision, else "Number
  out of range" as the server's `number out of range`; `settings.precision` caps the decimals
  further, currency defaults to 2), date `YYYY-MM-DD` string (checked as a real calendar
  date), select one of `options[].value`, checkbox `boolean`. Inputs emit stored values, not DOM
  strings: the number input parses (`parseNumberInput`: empty -> null, unparsable -> the raw
  string so the schema reports it), the date and select inputs turn `''` into `null`.
- **Required** makes the schema non-optional and non-empty (`''`, `null` and `undefined` all read
  as "This field is required", `REQUIRED_MESSAGE`); optional fields accept `null`/`undefined`
  (`.nullish()`). A required checkbox accepts `false`, matching
  `validate_record_custom_values()`.
- **`buildRecordSchema(fields)`** returns `z.strictObject({ [key]: schema })` in field order;
  unknown keys fail client-side exactly as `custom_values.<key>: unknown field` does on the
  server. `buildDefaultValues(fields)` gives a new record's starting values (text `''`, checkbox
  `false`, the rest `null`). An existing record's missing values use each entry's `emptyValue`
  instead (text `''`, every other type `null`): a checkbox that was never set stays unset in the
  form (shown unchecked) and is not sent unless the user changes it.
- **Formatting**: currency uses `Intl.NumberFormat` with `settings.currency` and precision (plain
  decimal when the code is missing or invalid), number uses the precision (max 6 decimals when
  unset), date goes through `formatDateOnly`, checkbox is Yes/No, select shows the option label
  or `<value> (removed option)` when the option is gone (B1). Missing values render as `''`.
- **`RecordFieldControl`** (`control`, `name`, `field`) renders label (with a required marker),
  the registry input, description and inline error through `useController`, so Part 12's form is
  a `useForm` over `buildRecordSchema` plus one `RecordFieldControl` per field under
  `custom_values.<key>`. `SelectFieldInput` keeps a removed-option value selectable (marked) until
  the user picks something else.
- **Server errors**: `parseCustomValuesError(error)` turns a 23514 `custom_values.<key>: <reason>`
  message into `{ key?, reason }` (regex `^custom_values(?:\.([a-z][a-z0-9_]*))?: (.+)$`);
  `describeCustomValuesReason` maps the documented reasons to the same copy the Zod schemas use,
  so Part 12 can `setError(`custom_values.${key}`, ...)` and show one message style.

### Modules feature (`src/features/modules/`)

- **Writes go to the tables directly** under RLS (`modules_*`, `field_definitions_*` policies:
  members read, owners and admins write); no Edge Function is involved because the database
  writes the audit rows (`module.created/updated/deleted`, `field.created/deleted`) and enforces
  every rule (slug unique per workspace, key immutable, type frozen while records hold values,
  options still in use, the options/settings shapes). The hooks only map errors
  (`getModuleErrorMessage`) and never offer what the server forbids: `FieldDialog` locks `key`
  and `type` on edit with a hint, and `useUpdateField` does not even accept them. A duplicate
  slug (23505, story B1) lands on the Slug input of `CreateModuleForm` and `ModuleSettingsForm`
  (`setModuleFieldError`, `role="alert"` inline error) instead of the form-level message; a
  unique constraint or key naming `name` lands on the name input. All field guards raise 23514;
  there is no `P0001` branch and no field cap.
- **Zero-row writes** (`.delete().select('id')` returning nothing, `.update().single()` giving
  `PGRST116`) are reported as not-found/forbidden exactly like the workspaces hooks.
  `useModule` uses `.maybeSingle()` so an id from another workspace renders the generic "Module
  not found" page (no detail about existence).
- **Positions**: a new module gets `position = count` (one `head: true` count query), a new
  field `position = fields.length` from the loaded list. Reordering (`moveField`) renumbers
  0..n-1 and issues one `update position` per changed row (PostgREST has no batch update; a
  module has a handful of fields and the database sets no cap), optimistically updating
  `['fields', ws, moduleId]`.
- **Record caches**: creating a module refreshes `['records', ws, 'counts']`; deleting one removes
  `['records', ws, moduleId]` and refreshes the counts; deleting a field invalidates
  `recordKeys.module(ws, moduleId)` (the server strips its key from the records).
- **Templates (B6)** live in `lib/templates.ts` as versioned code: `BLANK_TEMPLATE`,
  `HOUSEKEEPING_TASKS_TEMPLATE` (the D1 default, 8 fields) and `CLIENTS_TEMPLATE` (mirrors the
  seed). `applyTemplate(writer, template, module)` takes a `ModuleWriter`
  (`createModule`, `createField`, `deleteModule`), creates the module and then its fields in
  order, and on any field failure deletes the module again (best effort, fields cascade) and
  rethrows. `useCreateModule` binds the writer to Supabase (`createModuleWriter`) and runs the
  blank template for a manual create, so there is exactly one creation path for Phase 4's
  `check_entitlement`. The sequence is not one transaction (the only deviation from B6);
  supabase-engineer can provide `create_module_with_fields(...)` later and swap the writer.
  `TemplatePicker` shows each template's fields read-only; `uniqueModuleName` suffixes "(2)"
  when the template's name is taken. The database's `module.created` metadata is `{ name, slug }`
  (no `template` key); the client adds no audit row.
- **Select options** carry a stable `value` (what records store) and a `label`.
  `SelectOptionsEditor` derives the value from the label for options added in the dialog and
  freezes it for options that already existed, so relabelling keeps records valid; removing an
  option that records use fails server-side and is shown as "Option "x" is still used by
  records".
- **Permissions**: `canManageModules(role)` (owner, admin) only hides controls: the "New module"
  button, the Manage links, the Add/Edit/Move/Delete field actions, the settings form and the
  danger zone. Members see the modules list, the module page and the fields read-only.
- **Dashboard** gets a "Your modules" card (`ModulesOverview`); the sidebar gets "Modules".
  `ModuleUsageBadge` shows `workspace_usage().modules` and is where Phase 4 appends the plan
  limit.

### Records feature (`src/features/records/`)

Any member creates, edits and deletes records (RLS `records_*_member`); the UI does no role
gating. All reads are plain selects on `records` with `.eq('workspace_id')` and
`.eq('module_id')`, so a non-member's list, count and search are empty under RLS.

**URL contract** (`lib/records-query.ts`, unit-tested both ways):

```
?q=<search>&page=<n>&size=<25|50|100>&sort=<title|created_at|updated_at|status|f.<key>>&dir=<asc|desc>
 &f.<key>=<filter value>
```

Defaults (page 1, size 25, `updated_at desc`, no search or filters) are omitted when writing.
Custom fields sort as `f.<key>` so a field keyed `status` or `title` never collides with the
core column. Filter values: text `f.company=acme`; select repeats the parameter
(`f.status=lead&f.status=active`, any of them); checkbox `true`/`false`; number, currency and
date `min..max` with either side optional (`f.value=100..`, `f.due=..2026-12-31`). Parsing never
throws: invalid page/size/sort/dir fall back to the defaults, filters on unknown keys and invalid
values (unknown options, impossible dates, non-numbers) are dropped, search is capped at 200
characters. Other parameters (`tab`) survive. `useRecordsUrlState` writes with `replace` and
skips no-op writes; search and filter changes reset the page to 1; the search box is local state
written to the URL 300 ms after the last keystroke.

**Query building** (`lib/records-filters.ts`, applied in `api/record-queries.ts`):

- Select: explicit `RECORD_COLUMNS` (every column except the `search_vector` tsvector),
  `{ count: 'exact' }`, `.range(from, to)` with the page size capped at 100.
- Search (contract C4, `tokenizeSearch`, identical to the `export-records` tokenizer so the list
  and the export match the same rows): split the input on whitespace and on every character that
  is not a letter, mark, digit or one of `. @ - _ +`; strip `. @ - _ +` from both ends of each
  token; drop empty tokens; lowercase; dedupe; keep at most 8. Each token becomes `token:*`,
  joined with ` & `, and goes to `.textSearch('search_vector', q, { config: 'simple' })`.
  Examples: `12500.5` -> `12500.5:*`, `jane@acme.example` -> `jane@acme.example:*`, `-5` ->
  `5:*`, `a.b.` -> `a.b:*`, `"quoted"` -> `quoted:*`, `ACME acme` -> `acme:*`. Quotes, colons,
  ampersands, `!`, `|`, parentheses and `*` are separators, so input can never form query
  syntax. When no token remains (`...`) the search falls back to `.ilike('title', '%term%')`
  with backslash, `%` and `_` escaped.
- Filters (AND): text `.ilike('custom_values->>key', '%v%')`; one select option
  `.contains('custom_values', { key: v })` (GIN `jsonb_path_ops` index), several
  `.in('custom_values->>key', [...])`; checkbox `.contains('custom_values', { key: true|false })`;
  number and currency `.gte/.lte('custom_values->key', n)` (the `->` operator keeps jsonb, and
  jsonb compares numbers numerically, verified against the local PostgREST 16.5; no cast needed);
  date `.gte/.lte('custom_values->>key', 'YYYY-MM-DD')` (ISO dates order correctly as text).
- Sort: core columns directly; fields by `order('custom_values->key')` (jsonb ordering: numbers
  numerically, strings by collation, `false` before `true`), always `nullsFirst: false`, then
  `id` as a tie-breaker so pages never overlap.
- Out-of-range page (`PGRST103`, HTTP 416): `fetchRecords` runs a head-only count with the same
  criteria and returns `outOfRange`; the tab jumps to the last page.
- Counts per module (`useRecordCounts`): one `head: true` exact count per module in parallel
  (module ids from the cached modules list). Cheap for the MVP's few modules; a grouped count
  view or RPC can replace it later. The Modules cards and the dashboard card show it.

**Documented limitations:**

- Select fields sort by the stored option value, not by label (B3 asks for label order; needs a
  SQL function or view).
- A "max only" numeric range also matches a stored JSON `null` (jsonb null sorts below numbers).
  The app never stores nulls (`compactCustomValues` drops `null` and `''` before writing); only
  other writers could.
- Checkbox filters ignore records without a value (they are neither true nor false).
- PostgREST turns `*` in an ilike pattern into a wildcard, so a literal `*` in a text filter
  matches anything at that position.
- Search matches tokens by prefix only. Whether `acme` finds `ops@acme.example` depends on the
  stored document, not on the client: migration 006's `record_search_document` indexes
  punctuated values whole and in parts, so it does. A 1-character term already searches (B3
  says 2). The search box keeps what the user typed: the URL holds the trimmed term,
  and the box is only overwritten from the URL when `searchText.trim() !== query.search`
  (back/forward, a shared link, "Clear all"), so a trailing space survives the debounce.

**Writes:** `useCreateRecord` is the only insert path (Phase 4 hook for `check_entitlement`).
Edits go through `useUpdateRecord` -> `rpc('update_record', { p_record_id,
p_expected_updated_at, p_patch })` (contract C3; `api/update-record-rpc.ts` types the call locally
until `src/types/supabase.ts` is regenerated) and the returned row replaces the detail cache.
`EditRecord` keeps a **snapshot** of the record taken when the edit form opened (not the latest
cache) and builds `p_patch` with `buildRecordPatch(recordToFormValues(snapshot), values)`: only
changed core fields (`title`, `status`, `null` clears it) and changed custom keys go in, `set`
for new values and `unset` for keys cleared to empty; an empty patch sends nothing. The
snapshot's `updated_at` is `p_expected_updated_at`. A title-only edit of a stale record or of a
record whose checkbox was never set therefore sends `{ title }` alone, which the server accepts
without re-validating `custom_values`. Errors: `PT409` (`record_changed`) is the conflict below,
`PT404` reads as "This record no longer exists", 23514 lands on the field as before.
`useDeleteRecord` selects the deleted id and throws `RecordNotFoundError` on zero rows. Create and
delete invalidate the module's lists, `['records', ws, 'counts']` and `['usage', ws]`; delete
also removes `['attachments', ws, recordId]` and refreshes the audit feed; update refreshes the
detail cache and the lists.

**Conflicts (PT409):** the form shows a non-destructive `role="alert"` banner "This record was
changed by someone else. Reload to see the latest version; your edits are kept in the form." with
a **Reload** button; nothing in the form changes. Reload fetches the record now
(`useRefreshRecord`, `fetchQuery` with `staleTime: 0`), makes it the new snapshot and rebases the
form (`rebaseFormValues`, a three-way merge): every field the user changed since the form opened
keeps the user's value (and stays dirty), every other field takes the latest value. A polite
status then says "Loaded the latest version. Fields you had changed keep your edits; review them
and save again." The next save diffs against the new snapshot and sends its `updated_at`. If the
reload fails the banner stays with "The latest version could not be loaded"; if the record was
deleted meanwhile the page shows "Record not found".

**Form:** `RecordForm` is a `useForm` over `buildRecordFormSchema(fields)` (title, "Record
status" free text, one `RecordFieldControl` per field under `custom_values.<key>`). On a rejected
save, `mapRecordSaveError` puts a 23514 `custom_values.<key>: <reason>` onto that field
(`setError`, focused) with a form-level summary; 42501 shows the forbidden copy, everything else
a form-level message in `FormServerError`. If the key is not a field the form renders (a required
field was added in another tab), the form says the fields changed and invalidates
`['fields', ws, moduleId]`; the new control appears with the error on it. A stale record (a
required field added after it was created) is flagged in the read view ("Required field without
a value: Region") and the edit form requires the value. Cancel with unsaved changes asks
"Discard unsaved changes?"; closing the tab triggers `beforeunload`. A module without fields
shows an explanation and no submit button on "New record" (B2).

**Deviations from the Epic B text:** the record label is the `title` column (migration 004), not
the first field's value; the free-text core `status` is labelled "Record status" in the form so it
is not confused with a custom field named Status.

**Delete and attachments:** `useDeleteRecord` deletes only the row. The attachment rows cascade
and `enqueue_attachment_object_deletion` queues every object for `purge-attachments`; the client
does not remove the objects first, because any member may delete a record while only the
uploader or an owner/admin may remove each file. The delete dialog says attachments go too. The
server audits the delete as `record.deleted` with `{ module_id, title, attachment_count }`
(contract C5); "Recent activity" shows `deleted the record "Acme" (2 attachments)`.

**Create lands on the record:** since Part 14 `NewRecordPage` navigates (replace) to the new
record's page instead of the list, where the Attachments section is; uploads need a saved record,
so `RecordForm` has none.

**Export CSV (story B5):** `ExportCsvButton` sits next to "New record", rendered only when
`canExportRecords(role)` (owner, admin; the function answers members 403 anyway) and disabled
while the list loads or shows zero rows (`total === 0`). `exportRecords` (`api/use-export-records.ts`)
uses a raw `fetch`, not `functions.invoke`, because it needs the response headers and the raw
bytes: `POST ${supabaseUrl}/functions/v1/export-records` with `Authorization: Bearer <access token
from supabase.auth.getSession()>`, `apikey: <anon key>` and the body `buildExportBody(workspaceId,
moduleId, query)` = `{ workspaceId, moduleId, search?, filters? }` (trimmed search and the
`RecordFilter[]` of the URL state, each omitted when empty; sort and page are ignored). On 200 the
blob is saved through an object URL under the `Content-Disposition` name (`filename*=UTF-8''...`
wins over `filename="..."` and a bare `filename=`; path separators and control characters
become `_`), falling back to `<slug>-<UTC YYYY-MM-DD>.csv`. Errors: the envelope's
`error.code` (`forbidden`, `export_too_large`, `validation_error`, `unauthorized`,
`internal`), else the HTTP status (401 from the edge runtime, 413), a failed fetch is
`network`, no session is `unauthorized` without a request. `export_too_large` reads "More than
50,000 records match. Narrow the search or filters and try again." Success and errors are toasts
(sonner's live region); the response has no row count, so the toast says "Export downloaded".
Local note: the functions' CORS allow-list is `ALLOWED_ORIGIN` (`supabase/functions/.env`,
default `http://localhost:5173`), so open the dev app on `localhost`, not `127.0.0.1`, to export.

### Attachments feature (`src/features/attachments/`)

Any member lists, uploads and downloads (RLS `attachments_select_member`,
`attachments_insert_member`, the storage policies); the delete action is shown to the uploader and
to owners and admins (`canDeleteAttachment`), and the row and storage policies decide. Mounted
by `RecordDetail` as `AttachmentsSection` (heading, "n of 10", list, upload progress, dropzone).

**Local rules first** (`lib/attachment-rules.ts`, mirrors of migration 005; the server enforces
them again): `validateFile(file, existingCount)` checks the cap (existing count plus files
accepted earlier in the same batch), empty files, the 10 MB limit and the type, in that order.
The type is `resolveContentType`: the browser's `File.type` without parameters when it is on the
list, otherwise the extension's type (Windows reports `.csv` as `application/vnd.ms-excel` and
`.zip` as `application/x-zip-compressed`; some files have no type), otherwise refused.
`sanitiseFileName` keeps the last path segment, folds accents (NFKD, marks dropped), replaces each
run of characters outside `[A-Za-z0-9 !._*'()&$@=;:+,-]` with `_` (so `?`, `#` and `%`, which
migration 006 rejects because they break URLs, become `_` too), collapses whitespace, keeps an
alphanumeric extension of at most 16 characters while truncating to 255, trims, and falls back to
`file` (`報告書.pdf` -> `file.pdf`); dotfiles stay as they are. `AttachmentDropzone` runs
`validateFile` per file and shows one inline message per rejected file in an `role="alert"`
region; only the accepted files go on. The "Choose files" button is the keyboard path (the
`<input type="file" multiple accept={ACCEPT_ATTRIBUTE}>` is visually hidden); drag and drop
targets the same handler. Both are disabled at 10 files and while a batch runs.

**Upload sequence** (`uploadAttachment`, one file):

1. `validateFile` (throws `AttachmentError`, no request);
2. `from('attachments').insert({ workspace_id, record_id, file_name, content_type, size_bytes })
   .select(ATTACHMENT_COLUMNS).single()`: the generated `storage_path` comes back; a failure
   (23514 cap/size/type/name, 23503, 42501) uploads nothing;
3. `storage.from('attachments').upload(storage_path, body, { contentType, upsert: false })`.
   storage-js sends a `File`/`Blob` as multipart form data whose part type is the Blob's own
   type and ignores `contentType`, so when `File.type` differs from the resolved type the bytes
   are re-wrapped as `new Blob([file], { type: contentType })`; otherwise the storage insert policy
   (MIME must equal the row's `content_type`) would refuse the upload;
4. on an upload error (returned or thrown) the row is deleted by `workspace_id` and `id` (best
   effort; a failed rollback leaves a row without an object, the Phase 5 sweep) and the mapped error
   is thrown.

`useUploadAttachment(ws, recordId)` runs a batch sequentially through a `useMutation` over
`uploadAttachment`, passing the growing count, and keeps a local progress list per file
(`queued` -> `uploading` -> `done`, or `error` with the message until dismissed or the next
batch). supabase-js `upload` reports no byte progress, so "uploading" is an indeterminate
spinner. The batch never waits for a refetch between files: `['attachments', ws, recordId]` and
`['usage', ws]` are invalidated once when the batch ends (also after failures), and the `done`
entries ("Uploaded") leave the progress list when that refresh settles. A polite live region
announces "2 files uploaded." or "1 uploaded, 1 failed.".

**Download** (contract C1): `functions.invoke('attachment-url', { body: { attachmentId } })`
answers `{ data: { url, expiresAt } }`; a temporary anchor to `url` is clicked
(`triggerDownload`). The function checks membership and signs a short-lived URL that answers
with `Content-Disposition: attachment`, so the browser saves under the original name and the app
does not navigate. The browser never calls `createSignedUrl` or `storage.download`. Errors use
the `{ error: { code } }` envelope read like the members feature (`readFunctionError` in
`src/lib/function-errors.ts`, falling back to the HTTP status): 401 `unauthorized` -> "Your
session has expired", 404 `not_found` -> "This file or record no longer exists", 400
`validation_error` and 500 `internal` -> the generic file error, a failed fetch -> network. Errors
are toasts.

**Delete** (contract C2): only the row,
`from('attachments').delete().eq('workspace_id').eq('id').select('id')`. The
`enqueue_attachment_object_deletion` trigger queues the object for `purge-attachments`; the
browser never calls `storage.remove`. RLS filters a delete the caller may not make (or of a row
already gone) to zero rows, which reads as `AttachmentError('forbidden')` ("Only the uploader or
an owner or admin can remove this file, or it was already removed."). `useDeleteAttachment`
invalidates the list and usage on settle. `DeleteAttachmentDialog` keeps failures in the dialog
(`FormServerError`).

**Errors** (`lib/storage-errors.ts`): Storage answers policy denials with HTTP 400 and the logical
status in the body; storage-js copies the body's `statusCode` onto `StorageApiError`, which wins
over the HTTP status: 403 -> `forbidden`, 404 -> `not_found`, 409 -> `already_exists`, 413 ->
`too_large`, 415 -> `type_not_allowed`; a `StorageUnknownError` wrapping a fetch `TypeError` ->
`network`; anything else `unknown`. Row errors: 42501 -> `forbidden`, 23503/PGRST116 ->
`not_found`, 23514 by message (`at most 10 files`, `size_bytes`, `content_type`, else the name).

**Usage display:** `useWorkspaceUsage` returns the full `WorkspaceUsageRow` (fallback
`EMPTY_WORKSPACE_USAGE`, all zeros). The Modules page header shows `ModuleUsageBadge` ("1 module")
and `StorageUsageBadge` (`formatBytes(storage_bytes)` + " used", 1024-based units) next to the
heading (moved out of the `h1` so the heading's name stays "Modules"). Phase 4 appends the plan
limits to both.

### Route map

| Path                      | Guard             | Element                                                                  |
| ------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `/auth/sign-in`           | `PublicOnlyRoute` | `SignInPage` (signed-in users go to `?redirectTo` or `/`)                 |
| `/auth/sign-up`           | `PublicOnlyRoute` | `SignUpPage` -> `/auth/verify-email?email=` when confirmation is required |
| `/auth/forgot-password`   | `PublicOnlyRoute` | `ForgotPasswordPage`                                                     |
| `/auth/verify-email`      | `PublicOnlyRoute` | `VerifyEmailPage` ("check your inbox", resend)                           |
| `/auth/reset-password`    | needs session     | `ResetPasswordPage` (`updateUser({ password })`)                         |
| `/auth/callback`          | none              | `AuthCallbackPage` (code exchange, error display)                        |
| `/`                       | `ProtectedRoute`  | `WorkspaceProvider` > `AppLayout` > `RootRedirect` (-> `/w/<current>` or `/workspaces/new`) |
| `/workspaces/new`         | `ProtectedRoute`  | `AppLayout` > `CreateWorkspacePage` (first-run page; also reachable with workspaces) |
| `/w/:workspaceId`         | `ProtectedRoute`  | `AppLayout` > `WorkspaceRoute` > `DashboardPage` (workspaces list, recent activity) |
| `/w/:workspaceId/modules` | `ProtectedRoute`  | `WorkspaceRoute` > `ModulesPage` (cards with field count, usage badge, "New module" o/a, template empty state) |
| `/w/:workspaceId/modules/:moduleId` | `ProtectedRoute` | `WorkspaceRoute` > `ModulePage` (tabs via `?tab=`: Records: toolbar, table, pagination with the URL contract above; Fields: list; add/edit/reorder/delete o/a) |
| `/w/:workspaceId/modules/:moduleId/records/new` | `ProtectedRoute` | `WorkspaceRoute` > `NewRecordPage` (form; no-fields notice; after create -> the record page) |
| `/w/:workspaceId/modules/:moduleId/records/:recordId` | `ProtectedRoute` | `WorkspaceRoute` > `RecordPage` (read view with Attachments, delete dialog; `?edit=1` edit form; "Record not found" for unknown ids and ids of another module or workspace) |
| `/w/:workspaceId/modules/:moduleId/settings` | `ProtectedRoute` | `WorkspaceRoute` > `ModuleSettingsPage` (name, slug, description, icon; danger zone o/a with typed-name delete) |
| `/w/:workspaceId/members` | `ProtectedRoute`  | `WorkspaceRoute` > `MembersPage` (table, invite form o/a, pending invitations o/a) |
| `/w/:workspaceId/settings`| `ProtectedRoute`  | `WorkspaceRoute` > `WorkspaceSettingsPage` (general form; danger zone for owners) |
| `/invite/:token`          | `ProtectedRoute`  | `AppLayout` > `AcceptInvitationPage`                                     |
| `/settings/profile`       | `ProtectedRoute`  | `AppLayout` > `ProfileSettingsPage` (global, not workspace-scoped)       |
| `/*`                      | `ProtectedRoute`  | `AppLayout` > `NotFoundPage`                                             |

`ProtectedRoute` redirects to `/auth/sign-in?redirectTo=<path+search>`; `getSafeRedirect` only
honours same-origin paths outside `/auth/`. Both route groups have `RouteErrorBoundary` as
`errorElement`. A non-member visiting `/w/<id>` gets `WorkspaceRoute`'s not-found page (RLS
returns nothing for that id either way, so existence is not revealed); a module id from another
workspace under a workspace the user belongs to gets `ModuleNotFound` for the same reason. The
Epic B proposal's `/modules/new` is a dialog on the list instead. A record id from another
module or workspace (or a malformed id) gets `RecordNotFound` the same way.

## Still to come

- Part 3 (done 2026-10-30): pgTAP tests in `supabase/tests` (`01_rls_enabled` through `10_anon`)
  prove the matrix above, the role table, the last-owner guard, the audit triggers and the
  cross-workspace denials in `docs/PLANNING.md` section 7 for all five tables. Run with
  `npm run test:db`; CI job `db-tests`.
- Part 4 (done 2026-10-30): migration 002 (`accept_invitation`, tested in
  `11_accept_invitation_fn.sql`), Edge Functions `invite-member` and `accept-invitation` with the
  shared toolkit. `create-workspace` is deferred to Phase 4: the `on_workspace_created` trigger
  stays the creation path until plan limits must be checked before the insert.
- Part 6 (done 2026-10-30): workspaces and members UI, `WorkspaceProvider`, workspace-scoped
  routes and the invite acceptance page; Phase 2 exit criteria met. Follow-ups recorded in
  `docs/PLANNING.md` (invitation email delivery, code-splitting, profile FKs for embedding).
- Part 8a (done 2026-11-02): migration 003 (review fixes above), `12_review_fixes.sql`, the
  `invite-member` race handling. Suite: 12 files, 380 tests.
- Part 10 (done 2026-11-03): migration 004 (`modules`, `field_definitions`, `records`, search,
  `workspace_usage`), tests `13_isolation_modules` through `18_search_and_usage`, seed content.
  Suite: 18 files, 681 tests, passing on a fresh and on a used database.
- Part 11 (done 2026-11-04): field-type registry, `buildRecordSchema`, custom-values error
  parser, modules feature (list, templates, module page with Fields tab, settings, delete),
  "Modules" navigation and dashboard card, audit labels for module and field events. Vitest:
  37 files, 224 tests.
- Part 13 (done 2026-11-04): migration 005 (`attachments`, bucket `attachments` and its
  `storage.objects` policies, `storage_deletion_queue`, `workspace_usage` with `attachments` and
  `storage_bytes`), Edge Functions `export-records` and `purge-attachments`, tests
  `19_isolation_attachments` and `20_storage_policies`. Suite: 20 files, 850 tests, passing on a
  fresh and on a used database.
- Part 14 (done 2026-11-04): attachments UI on the record page (upload, download, delete),
  "Export CSV", storage usage on the Modules page, create -> record page. Vitest: 59 files, 418 tests.
- Part 15 (done 2026-11-04): Playwright primary journey and the isolation, auth and validation
  specs (`tests/e2e`, see `docs/operations.md`, "End-to-end tests").
- Part 17a (done 2026-11-04): migration 006 (Phase 3 review fixes above), Edge Function
  `attachment-url`, streaming `export-records`, reworked `purge-attachments`, pg_cron schedule,
  test `21_phase3_fixes`. Suite: 21 files, 973 tests, passing on a fresh and on a used database.
- Phase 3, still open: a transactional `create_module_with_fields` for templates (optional, see
  the modules section); the hosted Vault secrets for the purge job (Phase 5, `docs/operations.md`).
- Part 18a (done 2026-11-05): migration 007 (`plans`, `subscriptions`, `workspace_entitlements`,
  `check_entitlement` insert triggers, contract C6, `change_workspace_plan`), Edge Function
  `change-plan`, PT402 mapping in `invite-member` and `accept-invitation`, test
  `22_plans_and_entitlements`, concurrency case (e). Suite: 22 files, 1140 tests, passing on a
  fresh and on a used database. No `create-workspace` function was needed: the
  `workspaces_check_entitlement` trigger checks the workspace limit before the insert.
- Phase 4, still open: usage page and limit messages (Part 18b), platform admin web and its
  `change-plan` caller (Part 18c), billing provider per D3, the record-audit and record-ownership
  decisions.
