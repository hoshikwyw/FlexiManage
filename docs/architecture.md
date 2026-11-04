# Architecture

Database and backend reference. Maintained by the `supabase-engineer` agent; every new table,
function or policy is documented here in the same change that introduces it.
Last updated: 2026-11-04 (migration 005, attachments and the `attachments` bucket, Edge Functions
`export-records` and `purge-attachments`: see
[Attachments](#attachments-migration-20261104090000_005_attachmentssql)).

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
| Read and download attachments (005)          |  yes  |  yes  |  yes   |
| Add an attachment (upload)                   |  yes  |  yes  |  yes   |
| Delete own attachment                        |  yes  |  yes  |  yes   |
| Delete another member's attachment           |  yes  |  yes  |   no   |
| Export a module to CSV (`export-records`)    |  yes  |  yes  |   no   |

Records are writable by every member, including records created by someone else. This is the MVP
rule (migration 004): a small team shares one data set, and per-record ownership or a read-only
role is a Phase 4 decision together with record-level audit.

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
| `attachment.removed`  | `audit_attachment_change()` (005), direct deletes only | `attachment` / attachment id | `{ record_id, file_name, size_bytes }` |
| `records.exported`    | `export-records` Edge Function (`writeAudit`) | `module` / module id            | `{ module_id, row_count, filtered }`        |

Module changes to `position`, `description` or `icon` and field updates (label, required,
position, options, settings, type) are not audited. Fields removed by a module delete are not
audited one by one: the single `module.deleted` row stands for them. **Record writes produce no
audit events** (volume: every edit of every row); whether to log record create/delete, and for
which plans, is a Phase 4 decision.

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
| `workspace_usage(p_workspace_id uuid)` (004, recreated in 005) | one row `(modules int, records int, members int, attachments int, storage_bytes bigint)` | Counts for the usage page and the Phase 4 entitlement check; see [workspace_usage](#workspace_usagep_workspace_id-uuid). |
| `can_read_attachment_object(p_name text)` (005)     | boolean      | `storage.objects` select policy: an `attachments` row with `storage_path = name` exists and the caller is a member of its workspace. |
| `can_upload_attachment_object(p_name text, p_metadata jsonb)` (005) | boolean | `storage.objects` insert policy: matching row uploaded by the caller (still a member), no object yet, metadata size and MIME type equal the row's. |
| `can_delete_attachment_object(p_name text)` (005)   | boolean      | `storage.objects` delete policy: matching row exists and the caller is its uploader (and a member) or an owner/admin. |

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
| `modules` (004)     | `is_workspace_member(workspace_id)`             | o/a; `created_by = auth.uid()`; cols `id, workspace_id, name, slug, description, icon, position, created_by` | o/a; cols `name, slug, description, icon, position` | o/a                                       |
| `field_definitions` (004) | `is_workspace_member(workspace_id)`       | o/a; cols `id, workspace_id, module_id, key, label, type, required, position, options, settings` | o/a; cols `key, label, type, required, position, options, settings` (triggers guard `key`/`type`) | o/a |
| `records` (004)     | `is_workspace_member(workspace_id)`             | member; `created_by = auth.uid()`; cols `id, workspace_id, module_id, title, status, custom_values, created_by` | member; cols `title, status, custom_values` | member                              |
| `attachments` (005) | `is_workspace_member(workspace_id)`             | member; `uploaded_by = auth.uid()` (default, not insertable); cols `workspace_id, record_id, file_name, content_type, size_bytes` | none (immutable) | uploader (still a member), or o/a |
| `storage_deletion_queue` (005) | none                                 | none                                                           | none                                                | none (service role only)                                            |
| `storage.objects` in bucket `attachments` (005) | `can_read_attachment_object(name)` | `can_upload_attachment_object(name, metadata)` | none | `can_delete_attachment_object(name)` |

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
-- on storage.objects (bucket attachments):
attachments_objects_select_member          attachments_objects_insert_uploader
attachments_objects_delete_uploader_or_owner_admin
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
| `title`         | text        | not null, 1..200                                                            |
| `status`        | text        | null or <= 50 chars; free text in the MVP (a module-level status list is a later decision) |
| `custom_values` | jsonb       | not null, default `{}`; `{ "<field key>": value }`, validated by trigger    |
| `search_vector` | tsvector    | generated always as `to_tsvector('simple', title || ' ' || status || ' ' || jsonb_values_text(custom_values))` stored; read-only |
| `created_by`    | uuid        | default `auth.uid()`, `references auth.users on delete set null`            |
| `created_at`, `updated_at` | timestamptz |                                                                  |

Indexes: `records_workspace_module_created_idx (workspace_id, module_id, created_at desc)` for
listing, `records_search_vector_idx` (GIN) for full-text search, `records_custom_values_idx` (GIN
`jsonb_path_ops`) for `custom_values @> '{"status": "active"}'` filters, `records_title_trgm_idx`
(GIN `gin_trgm_ops`, extension `pg_trgm` in schema `extensions`) for `title ilike '%...%'`.

Search contract: `search_vector @@ to_tsquery('simple', 'acme:*')` (prefix) or
`plainto_tsquery('simple', 'yak inc')` (all words). The `simple` configuration does no stemming
and no stop words, so it is language-neutral. Booleans, nested objects and arrays in
`custom_values` are not indexed; numbers are indexed as their text (`4200`). Through PostgREST:
`.textSearch('search_vector', 'acme:*', { config: 'simple' })` or `.ilike('title', '%acme%')`,
always with `.eq('workspace_id', id)` (RLS enforces it anyway).

### Custom value validation (`validate_record_custom_values()`)

Runs before insert and before an update that sets `custom_values` or `module_id`. It reads the
module's `field_definitions` and raises SQLSTATE `23514` (`check_violation`) with exactly one of
these messages (first failure wins: object shape, then unknown keys in alphabetical order, then
the fields by `position`, each checking required before type):

| Message                                                | When                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `custom_values: expected object`                       | `custom_values` is not a JSON object                                          |
| `custom_values.<key>: unknown field`                   | key is not a field of the module (never silently dropped)                     |
| `custom_values.<key>: required`                       | required field absent, `null` or `""`                                         |
| `custom_values.<key>: expected string`                 | `text` or `select` value is not a JSON string                                 |
| `custom_values.<key>: text longer than 2000 characters` | `text` value longer than 2000 chars                                          |
| `custom_values.<key>: expected number`                 | `number` or `currency` value is not a JSON number                             |
| `custom_values.<key>: expected date YYYY-MM-DD`        | `date` value is not a string matching `^\d{4}-\d{2}-\d{2}$` that casts to a date |
| `custom_values.<key>: expected boolean`                | `checkbox` value is not a JSON boolean                                        |
| `custom_values.<key>: not one of the options`          | `select` value is not one of `options[].value` (case-sensitive)              |

Rules: `null` (or absence) is accepted for a non-required field of any type and means "no
value"; values are stored as given (nulls are kept). A required `checkbox` accepts `false`.
Clients map the message with the regex `^custom_values(?:\.([a-z0-9_]+))?: (.+)$` (group 1 = field
key or none, group 2 = reason) and show it on the matching form field. The error also carries
`column = 'custom_values'` in the PostgREST `details`.

Nested invocations are skipped (`pg_trigger_depth() > 1`); the only nested caller is
`handle_field_deleted()` below.

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
skips validation (so a stale record does not block the delete) and moves the affected records'
`updated_at`. During a module or workspace cascade the trigger does nothing.

### `workspace_usage(p_workspace_id uuid)`

`security definer`, `stable`, `set search_path = ''`, executable by `authenticated` only. Returns
one row `(modules integer, records integer, members integer, attachments integer, storage_bytes
bigint)` for the workspace, counting every module, every record and every membership regardless
of role, every `attachments` row, and the sum of their `size_bytes` (0 when there are none).
Migration 005 recreated it (drop + create, because a new return type cannot be `create or
replace`d); the argument list and the first three columns are unchanged, so existing callers keep
working. `storage_bytes` counts declared sizes, which equal the stored sizes for every uploaded
object (the upload policy requires it); a row whose upload never happened still counts until it is
deleted. Frontend type contract: `WorkspaceUsageRow` in `src/types/database.ts` is the full
row; `WorkspaceUsage` is pinned to `modules, records, members` until Part 14 moves the usage
hook to `WorkspaceUsageRow`. A caller who is not a member of the
workspace (including an unknown id, so existence is not revealed, and a call without a JWT) gets
SQLSTATE `42501` `not a member of this workspace`; `anon` gets `42501 permission denied for
function workspace_usage`. Through PostgREST: `supabase.rpc('workspace_usage', { p_workspace_id })`
returns `{ modules, records, members, attachments, storage_bytes }[]` with one element
(`storage_bytes` is a JSON number). Phase 4's entitlement check will call
it inside the same transaction as the insert; the usage page reads it directly, so both see the
same numbers.

### Not decided yet (Phase 4)

- Record-level audit (`record.created` / `record.deleted`) and per-record ownership or a read-only
  role; today every member writes every record and nothing is logged.
- A module-level status list for `records.status` (free text today).
- Enforcing module and record limits before insert (`check_entitlement` with `workspace_usage`).

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
| message `attachments: at most 10 files per record`  | 11th row on one record (`enforce_attachment_cap()`, per-record advisory lock so parallel inserts cannot both pass at 9) |
| `23503` `attachments_record_workspace_fkey`         | `record_id` is not a record of `workspace_id` (another workspace's record) |
| `42501` new row violates row-level security          | `workspace_id` is not a workspace of the caller                    |
| `42501` permission denied for table attachments      | the insert names `id`, `uploaded_by` or `created_at`; any update  |

Audit: `attachment.added` (insert) and `attachment.removed` (direct delete) with metadata exactly
`{ record_id, file_name, size_bytes }` and the caller as `actor_id`; no path, MIME type or
content. Attachments removed by a record, module or workspace cascade are not logged per file
(the record row is gone; record deletes are not audited in the MVP).

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

How Storage evaluates them (verified on CLI 2.122, storage-api 1.84.19): storage-api runs every
object query as the caller's Postgres role (`authenticated`, `request.jwt.claims` set), so
`auth.uid()` is the caller and RLS on `storage.objects` decides. Before writing any bytes it calls
`storage.can_insert_object()`, which performs the insert (metadata still null) and rolls it back,
so a refused upload never reaches the backend; after the upload it inserts the row with
`metadata` (`size`, `mimetype`, ...) and RLS is checked again (an upload refused at that point
leaves no file either; checked on the local file backend). Downloads, signed-URL creation and
listing are selects; removal is `delete ... returning`, which needs the select policy as well.
`owner` / `owner_id` are set to the uploader but are not used for authorization: the
`attachments` row is the source of truth.

Three policies on `storage.objects`, each `bucket_id = 'attachments' and <helper>`, each calling one
security definer helper (no inline membership subquery; the helpers use `is_workspace_member` /
`has_workspace_role`):

| Command | Policy                                              | Helper and rule                                                                 |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| select  | `attachments_objects_select_member`                 | `can_read_attachment_object(name)`: a row with `storage_path = name` exists and the caller is a member of its workspace |
| insert  | `attachments_objects_insert_uploader`               | `can_upload_attachment_object(name, metadata)`: the row exists, `uploaded_by = auth.uid()` and the caller is still a member, no object exists under the name yet, and when the metadata is known its `size` equals `size_bytes` and its `mimetype` (parameters such as `;charset=` ignored) equals `content_type` |
| update  | none                                                | objects are immutable: `x-upsert: true`, move and copy are refused              |
| delete  | `attachments_objects_delete_uploader_or_owner_admin` | `can_delete_attachment_object(name)`: the row exists and the caller is its uploader (and a member) or an owner/admin |

Because `storage_path` is generated from `workspace_id`, `record_id` and `id`, the equality
`storage_path = name` also proves that the first path segment is the row's workspace and the
second its record, and the composite foreign key ties that record to the same workspace; no
`storage.foldername(name)` parsing is needed. Deliberate differences from the B4 text: only the
**uploader** may upload the bytes for a row (an owner cannot fill someone else's pending row),
and an object whose row is already gone is neither readable nor deletable by clients (making
orphans readable would let members download a file that was just removed; `purge-attachments`
removes them).

HTTP results against the local stack (2026-11-04). Storage answers policy denials with HTTP
**400** and the logical status in the JSON body (`statusCode`); clients should switch on the body:

| Request                                                             | HTTP | body `statusCode` / `error`     |
| ------------------------------------------------------------------- | ---: | ------------------------------- |
| alice uploads to her row's `storage_path`                           |  200 |                                 |
| alice downloads it (`/object/authenticated/...`), creates a signed URL |  200 |                              |
| bob (workspace B) downloads it, or creates a signed URL for it      |  400 | `404` `not_found`               |
| public URL of the object                                            |  400 |                                 |
| alice uploads to a path without a row, or under B's prefix          |  400 | `403` `Unauthorized`            |
| alice uploads again to the same path (`x-upsert: true` or not)      |  400 | `403` `Unauthorized`            |
| upload whose size or MIME type differs from the row                 |  400 | `403` `Unauthorized`            |
| upload with a MIME type outside the bucket list                     |  400 | `415` `invalid_mime_type`       |
| bob removes alice's object                                          |  200 | `[]` (nothing removed)          |

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
   the Storage API and deletes the queue rows; failures increment `attempts` (entries stop being
   retried after 10) and keep `last_error`. Removing an object that is already gone is not an
   error, so a client that removed the object first (B4 order) leaves a harmless queue entry.
3. Schedule: none yet. Phase 5 calls it every 10 minutes (pg_cron + pg_net, or a GitHub
   Actions cron with the service-role key from secrets); until then an operator runs it by hand
   (`docs/operations.md`, "Attachments bucket").

`storage_deletion_queue` columns: `id` bigint identity, `bucket_id`, `object_name`,
`workspace_id`, `enqueued_at`, `attempts`, `last_error` (<= 500), `last_attempt_at`. RLS enabled,
no policies, no grants for `anon` or `authenticated`; only `service_role` reads and writes it.
Between the row delete and the purge an orphaned object is unreachable for clients (no row, so
no select policy match). The reverse orphan, a row whose upload never happened, stays until
someone deletes it (it shows as a broken download and counts toward `storage_bytes`); a
scheduled sweep of rows without an object older than a day is a Phase 5 task.

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
| `errors.ts`     | `AppError`, `ErrorCode`, `jsonOk`, `jsonError`, `toAppError` | Envelope `{ data }` or `{ error: { code, message, details? } }`; unknown errors -> `internal`. |
| `handler.ts`    | `createHandler(methods, fn)`                                | Wraps a function with preflight, method check and error mapping.                            |
| `auth.ts`       | `requireUser(req)`, `adminClient()`, `requireWorkspaceRole()`, `requireServiceRole(req)` | User-scoped client (anon key + caller JWT), service-role client, membership/role check; operator-only guard (bearer must equal the service-role or secret key, constant-time compare). |
| `validation.ts` | `parseBody(req, schema)`                                    | JSON body through a Zod schema; failures -> 400 `validation_error` with flattened issues.    |
| `audit.ts`      | `writeAudit(admin, event)`                                  | Inserts an `audit_events` row for writes no trigger covers (`export-records`: `records.exported`). |
| `csv.ts`        | `buildCsv`, `csvRow`, `quoteField`, `neutralizeFormula`, `formatFieldCell`, `formatNumber`, `formatTimestamp`, `exportFileName`, `CSV_BOM` | Pure CSV helpers for `export-records` (no Deno or Supabase imports); tests in `csv.test.ts`. |
| `types.ts`      | `WorkspaceRole`, `WORKSPACE_ROLES`                          | Mirror of the `workspace_role` enum.                                                        |

### Error codes

| HTTP | `error.code`         | Raised when                                                                                    |
| ---: | -------------------- | ---------------------------------------------------------------------------------------------- |
|  400 | `validation_error`   | Body is not JSON or fails the Zod schema; `details` holds `{ formErrors, fieldErrors }`.         |
|  401 | `unauthorized`       | No bearer token, or `auth.getUser()` rejects it. With `verify_jwt = true` the runtime answers a malformed or expired JWT first, with its own body (`{ code: "UNAUTHORIZED_..." }`); clients switch on the status. |
|  403 | `forbidden`          | Caller is not a member, has an insufficient role, an admin invites as owner, or an invitation belongs to a different (or unverified) email. Non-membership and wrong role share one code so workspace existence is not revealed. |
|  404 | `not_found`          | Invitation token unknown or already used.                                                      |
|  405 | `method_not_allowed` | Anything but `POST` (and `OPTIONS`).                                                           |
|  409 | `conflict`           | The invited email already belongs to a member of the workspace.                                |
|  410 | `invitation_expired` | `expires_at` has passed.                                                                       |
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
winner's row.

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
`not_found`, `PT410` -> 410 `invitation_expired`.

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
with exactly the PostgREST operators of `src/features/records/lib/records-filters.ts`, so the
export of a filtered view contains the rows the table shows (in `created_at, id` order, not the
table's sort).

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
- Formula injection: every text cell (title, status, text, select label, timestamps) that
  starts with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`. Number and currency cells are
  produced from JSON numbers and are exempt, so `-42.5` stays a number.

Rules and order: verify the JWT (`401`), validate the body (`400`), require owner or admin in the
workspace via the service-role membership lookup (`403 forbidden` for `member`, non-members and
unknown workspaces), load the module with the caller's client under RLS bound to `workspace_id`
and `id` (`403 forbidden` with the identical body when it is not in the workspace, so existence is
not revealed), count matching rows (`413 export_too_large`, `details: { limit: 50000 }`, above
50,000), read the rows with the caller's client (RLS applies; `workspace_id` and `module_id`
are bound in every query) in keyset pages of 1,000 on `(created_at, id)`, build the CSV, write
`records.exported` `{ module_id, row_count, filtered }` (`filtered` = non-empty search or any
filter) with `writeAudit` and the caller as `actor_id`, respond. A failure at any step writes no
audit row and returns no CSV. Exports are not metered and are available on every plan.

Deviations from the B5 text, as specified for Part 13: the header is `Title, Record status,
<labels>, Created at, Updated at` (no `id`, no `created_by` display name), checkbox values are
`TRUE` / `FALSE`, and records are read with the caller's client (RLS) rather than the service
role. Performance on the local stack: 50,000 rows in about 11 s (offset paging took 92 s because
each page re-evaluated RLS for every earlier row; keyset paging is linear). Rate limiting is
Phase 5.

### `purge-attachments` (POST, operators only)

Request `{}` or `{ limit?: 1..1000 }` (default 200), with `Authorization: Bearer <service-role
key>`. Response `200 { data: { purged, failed, remaining } }`. Any other bearer (a user JWT, the
anon key) gets `403 forbidden`; none gets `401`. It reads the oldest queue entries with fewer than
10 attempts, skips names that a live `attachments` row still uses (defensive; impossible by
construction), removes the objects with `storage.from(bucket).remove(names)`, deletes the
processed queue rows and, on a Storage error, increments `attempts` and stores `last_error`.
Idempotent and safe to run concurrently. Not audited: the deletion it completes was audited as
`attachment.removed` (or is part of a record, module or workspace delete). `verify_jwt = true`
works with the legacy service-role JWT; a hosted project that only has `sb_secret_...` keys
must set `verify_jwt = false` for this function (it checks the key itself).

## Frontend (`src/`)

React SPA (Vite, TypeScript strict, React Router 7, TanStack Query 5, React Hook Form + Zod 4,
shadcn/ui on Base UI). Maintained by the `frontend-dev` agent. Part 5 (2026-10-30) added the
authentication screens, the protected routing and the app shell; Part 6 (2026-10-30) added the
workspaces and members features, the workspace context and the workspace-scoped route map,
completing Phase 2. Part 11 (2026-11-04) added the field-type registry and the modules feature
(list, templates, module page with a Fields tab, settings); Part 12 (2026-11-04) added the records
list (search, filters, sort, pagination in the URL), the record form and the record pages.

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
                       or field label)
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
                       structural builder: search, filters, sort; buildPrefixTsQuery, escapeLike),
                       record-values.ts (compactCustomValues, diffRecordPayload), record-errors.ts
                       (getRecordErrorMessage, mapRecordSaveError, RecordNotFoundError),
                       filter-labels.ts (chip text), pagination.ts (describePageRange, lastPage)
  api/                 keys.ts (['records', ws, moduleId, 'list', query], [..., 'detail', id],
                       ['records', ws, 'counts']); record-queries.ts (fetchRecords, countRecords,
                       fetchRecord, fetchRecordCounts, RECORD_COLUMNS); useRecords, useRecord,
                       useRecordCounts, useCreateRecord, useUpdateRecord, useDeleteRecord,
                       invalidate.ts (lists + counts + ['usage', ws])
  schemas/record.ts    buildRecordFormSchema(fields) (title 1..200, status <= 50, custom_values =
                       buildRecordSchema), emptyRecordFormValues, recordToFormValues,
                       toRecordPayload, missingRequiredFields
  hooks/               useRecordsUrlState(fields) (useSearchParams <-> RecordsQuery, replace)
  components/          RecordsTab (+ RecordsList), RecordsToolbar, filters/ (FILTER_CONTROLS per
                       registry filterKind: Text, Options, Boolean, NumberRange, DateRange),
                       RecordsTable, RecordsTableStates (skeleton, error, "No records yet",
                       "No records match"), RecordsPagination, RecordForm, DiscardChangesDialog,
                       RecordDetail, DeleteRecordDialog
  pages/               NewRecordPage, RecordPage (read / ?edit=1, RecordNotFound), RecordPageShell
                       (module + fields loading, breadcrumb)
  types.ts             RecordItem, RecordsQuery, RecordFilter, RecordSort, PageSize, RecordsPage
src/features/modules/
  api/                 keys.ts (['modules', ws], ['module', ws, id], ['fields', ws, moduleId],
                       ['usage', ws]); module-writes.ts (countModules, insertModule, insertField,
                       deleteModuleRow, deleteFieldRow, createModuleWriter: the raw statements, no
                       React); useModules(ws) (position then name, plus a field count per module
                       from a second `field_definitions` select), useModule(ws, id) (maybeSingle:
                       null = not found or hidden), useCreateModule(ws) (count -> position,
                       applyTemplate, invalidates list, usage, audit), useUpdateModule(ws, id),
                       useDeleteModule(ws) (navigate first, invalidate second),
                       useFieldDefinitions(ws, moduleId) (position order), useCreateField,
                       useUpdateField (label, required, options, settings only: never key or
                       type), useDeleteField (also invalidates ['records', ws, moduleId]),
                       useReorderFields (moveField + one position update per changed row,
                       optimistic), useWorkspaceUsage(ws) (rpc workspace_usage)
  schemas/             module.ts (name 1..100, slug as workspaces, description <= 500, icon from
                       MODULE_ICONS or '', templateId), field.ts (label 1..100, key
                       ^[a-z][a-z0-9_]{0,49}$, type from FIELD_TYPES, required, options 1..100
                       with distinct values for select, settings.currency from CURRENCY_CODES,
                       precision 0..6; fieldFormSchema is one flat form refined by type)
  lib/                 module-errors.ts (23505 -> slug or key taken, 23514 -> options/settings
                       check or the field guard messages, 42501 -> forbidden, PGRST116/23503 ->
                       not found, ModuleNotFoundError/FieldNotFoundError for zero-row writes),
                       module-permissions.ts (canManageModules o/a), field-key.ts
                       (deriveFieldKey, deriveOptionValue), field-payload.ts (form -> columns,
                       strips options/settings the type does not use), field-summary.ts,
                       module-icons.ts (curated lucide names incl. the seed's building-2),
                       currencies.ts, module-names.ts (uniqueModuleName -> "(2)" suffix),
                       templates.ts (section below)
  components/          ModulesList (+ empty state, skeleton), ModuleCard (field and record
                       counts), ModuleIcon,
                       ModuleUsageBadge, ModulesOverview (dashboard card), CreateModuleDialog,
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
src/lib/               format.ts (formatDate/formatDateTime for timestamps; parseIsoDate and
                       formatDateOnly for `YYYY-MM-DD` values, parsed as local calendar dates so
                       they never shift by a day), postgrest-errors.ts (isPostgrestError,
                       isNetworkError), workspace-roles.ts (getRoleLabel)
src/types/database.ts  Row aliases: Profile, Workspace, WorkspaceMember, Invitation, AuditEvent,
                       WorkspaceRole, WORKSPACE_ROLES; migration 004: Module, FieldDefinition,
                       RecordRow (+ Insert/Update), FieldType, FIELD_TYPES, SelectOption,
                       FieldSettings, WorkspaceUsage
src/test/              render.tsx (providers + MemoryRouter), supabase-mock.ts (auth, from,
                       functions.invoke), workspace-context.tsx (stubbed WorkspaceProvider value),
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
  `string` (trimmed, <= 2,000), number and currency `number` (finite; `settings.precision` caps
  the decimals, currency defaults to 2), date `YYYY-MM-DD` string (checked as a real calendar
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
  `false`, the rest `null`).
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
  and `type` on edit with a hint, and `useUpdateField` does not even accept them.
- **Zero-row writes** (`.delete().select('id')` returning nothing, `.update().single()` giving
  `PGRST116`) are reported as not-found/forbidden exactly like the workspaces hooks.
  `useModule` uses `.maybeSingle()` so an id from another workspace renders the generic "Module
  not found" page (no detail about existence).
- **Positions**: a new module gets `position = count` (one `head: true` count query), a new
  field `position = fields.length` from the loaded list. Reordering (`moveField`) renumbers
  0..n-1 and issues one `update position` per changed row (PostgREST has no batch update; fields
  are capped at 50), optimistically updating `['fields', ws, moduleId]`.
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
- Search: the term's runs of letters, marks and digits become `word:*` joined with ` & ` (max 8
  words, lowercased, deduplicated) and go to
  `.textSearch('search_vector', q, { config: 'simple' })`. Quotes, colons, ampersands and other
  tsquery syntax are dropped, so input can never form query syntax. A term without word
  characters falls back to `.ilike('title', '%term%')` with backslash, `%` and `_` escaped.
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
- Search matches tokens by prefix only: `ops@acme.example` is one email token, so "acme" does
  not find it; "1234.5" becomes `1234:* & 5:*`. A 1-character term already searches (B3 says 2).

**Writes:** `useCreateRecord` is the only insert path (Phase 4 hook for `check_entitlement`).
`useUpdateRecord` sends only the changed columns of `title`, `status`, `custom_values`
(`diffRecordPayload`), so a title-only edit of a stale record still succeeds server-side;
`.single()` turns a vanished row into `PGRST116`. `useDeleteRecord` selects the deleted id and
throws `RecordNotFoundError` on zero rows. Create and delete invalidate the module's lists,
`['records', ws, 'counts']` and `['usage', ws]`; update refreshes the detail cache and the lists;
`useDeleteField` already invalidates `['records', ws, moduleId]`.

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

**Slots for Parts 13-14:** `RecordDetail` has an "Attachments" section placeholder,
`RecordForm` a commented upload slot, `RecordsTab` a commented "Export CSV" slot next to "New
record", and `useDeleteRecord` is where attachment rows and storage objects join the delete.

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
| `/w/:workspaceId/modules/:moduleId/records/new` | `ProtectedRoute` | `WorkspaceRoute` > `NewRecordPage` (form; no-fields notice) |
| `/w/:workspaceId/modules/:moduleId/records/:recordId` | `ProtectedRoute` | `WorkspaceRoute` > `RecordPage` (read view, delete dialog; `?edit=1` edit form; "Record not found" for unknown ids and ids of another module or workspace) |
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
  fresh and on a used database. Part 14 builds the upload, download and export UI.
- Phase 3, still open: the attachment and export UI (Part 14, contract above); scheduling
  `purge-attachments` (Phase 5); a transactional `create_module_with_fields` for templates
  (optional, see the modules section).
- Phase 4: billing tables, `check_entitlement` (on top of `workspace_usage`), `create-workspace`,
  the record-audit and record-ownership decisions.
