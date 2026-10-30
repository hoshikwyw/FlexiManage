-- Migration 001: tenancy and audit
--
-- Tables:  profiles, workspaces, workspace_members, invitations, audit_events
-- Helpers: is_workspace_member, has_workspace_role, current_user_workspace_ids,
--          shares_workspace_with
-- Every table has RLS enabled with one policy per command, built on the
-- security definer helpers so no policy inlines a membership subquery.
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- gen_random_uuid() is built into PostgreSQL 13+. pgcrypto is needed for
-- gen_random_bytes() (invitation tokens). Supabase installs it in the
-- `extensions` schema, so this is a no-op locally and in the cloud.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'admin', 'member');

comment on type public.workspace_role is
  'Role of a user inside one workspace. owner > admin > member.';

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Row trigger: stamps updated_at = now() before every update.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Public mirror of auth.users (one row per user). Created automatically by the handle_new_user trigger; never inserted directly by clients.';
comment on column public.profiles.id is 'Same value as auth.users.id.';
comment on column public.profiles.email is 'Copied from auth.users.email at signup.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile row whenever Supabase Auth inserts a user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users after-insert trigger: creates the matching public.profiles row. Security definer because the auth admin role has no privileges on public.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 60),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.workspaces is
  'A tenant. Every tenant-owned row in other tables carries workspace_id referencing this table.';
comment on column public.workspaces.slug is
  'URL-safe unique identifier: lowercase letters, digits and single hyphens, 1..60 chars.';
comment on column public.workspaces.created_by is
  'User who created the workspace; becomes the first owner via handle_new_workspace.';

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.workspace_role not null default 'member',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

comment on table public.workspace_members is
  'Membership of a user in a workspace with a role. The source of truth for every RLS decision.';

create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (char_length(email) between 3 and 320),
  role          public.workspace_role not null default 'member',
  token         text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  invited_by    uuid references auth.users (id) on delete set null,
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index invitations_workspace_id_idx on public.invitations (workspace_id);
create index invitations_email_lower_idx on public.invitations (lower(email));

comment on table public.invitations is
  'Pending invitations to join a workspace. Accepted through an Edge Function (Part 4) using the token; never updated directly by clients.';
comment on column public.invitations.token is
  '64 hex chars (32 random bytes). Sent to the invitee; exchanged for membership by the accept-invitation function.';

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  actor_id      uuid references auth.users (id) on delete set null,
  action        text not null check (char_length(action) between 1 and 100),
  entity_type   text not null check (char_length(entity_type) between 1 and 100),
  entity_id     text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_events_workspace_created_idx
  on public.audit_events (workspace_id, created_at desc);

comment on table public.audit_events is
  'Append-only log of privileged actions per workspace. Written only by security definer triggers and Edge Functions; clients can read, never write.';
comment on column public.audit_events.action is
  'Dotted verb: workspace.created, member.added, member.role_changed, member.removed, invitation.created, invitation.revoked.';
comment on column public.audit_events.actor_id is
  'auth.uid() at the time of the write; null for system or seed writes.';

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
-- All helpers are security definer so they read workspace_members without
-- triggering its own RLS policies (which would otherwise recurse). They never
-- take the caller's identity as a parameter; it always comes from auth.uid().

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'True when auth.uid() has any role in the given workspace. Building block for select policies.';

create or replace function public.has_workspace_role(
  p_workspace_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

comment on function public.has_workspace_role(uuid, public.workspace_role[]) is
  'True when auth.uid() holds one of the given roles in the workspace, e.g. has_workspace_role(id, array[''owner'',''admin'']::public.workspace_role[]).';

create or replace function public.current_user_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_members m
  where m.user_id = auth.uid();
$$;

comment on function public.current_user_workspace_ids() is
  'All workspace ids auth.uid() belongs to. For policies on tables keyed by id rather than workspace_id.';

create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

comment on function public.shares_workspace_with(uuid) is
  'True when auth.uid() and p_user_id are both members of at least one common workspace. Used by the profiles select policy.';

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
revoke all on function public.current_user_workspace_ids() from public, anon;
revoke all on function public.shares_workspace_with(uuid) from public, anon;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function public.current_user_workspace_ids() to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace creation trigger: creator becomes owner, audit row is written.
-- Keeps workspace creation atomic without an Edge Function. Part 4 may move
-- this into create-workspace once plan limits must be checked first.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null then
    raise exception 'workspaces.created_by must be set'
      using errcode = 'check_violation';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    new.id,
    new.created_by,
    'workspace.created',
    'workspace',
    new.id::text,
    jsonb_build_object('name', new.name, 'slug', new.slug)
  );

  return new;
end;
$$;

comment on function public.handle_new_workspace() is
  'workspaces after-insert trigger: inserts created_by as owner in workspace_members and writes the workspace.created audit event.';

revoke all on function public.handle_new_workspace() from public, anon, authenticated;

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- ---------------------------------------------------------------------------
-- Last-owner guard: a workspace must always keep at least one owner.
-- Fires before update (demotion) and delete (removal) of an owner row.
-- ---------------------------------------------------------------------------
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  -- Only relevant when an owner row stops being an owner row.
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.workspace_id = old.workspace_id then
    return new;
  end if;

  -- Cascade from deleting the workspace itself: nothing left to protect.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;

  select count(*) into v_remaining
  from public.workspace_members m
  where m.workspace_id = old.workspace_id
    and m.role = 'owner'
    and m.user_id <> old.user_id;

  if v_remaining = 0 then
    raise exception 'cannot remove or demote the last owner of workspace %', old.workspace_id
      using errcode = 'P0001', hint = 'Promote another member to owner first.';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.protect_last_owner() is
  'workspace_members before update/delete trigger: rejects a change that would leave a workspace with zero owners.';

revoke all on function public.protect_last_owner() from public, anon, authenticated;

create trigger workspace_members_protect_last_owner
  before update or delete on public.workspace_members
  for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------------------
-- Audit membership and invitation changes made directly through the API.
-- Edge Functions (Part 4) add richer events; these triggers guarantee a
-- baseline row for every privileged write.
-- ---------------------------------------------------------------------------
create or replace function public.audit_workspace_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, auth.uid(), 'member.added', 'workspace_member', new.user_id::text,
            jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role <> old.role then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (new.workspace_id, auth.uid(), 'member.role_changed', 'workspace_member', new.user_id::text,
              jsonb_build_object('from', old.role, 'to', new.role));
    end if;
    return new;
  else
    -- Skip when the workspace itself is being deleted (cascade); the FK would fail.
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.workspace_id, auth.uid(), 'member.removed', 'workspace_member', old.user_id::text,
              jsonb_build_object('role', old.role));
    end if;
    return old;
  end if;
end;
$$;

comment on function public.audit_workspace_member_change() is
  'workspace_members after trigger: writes member.added / member.role_changed / member.removed audit events.';

revoke all on function public.audit_workspace_member_change() from public, anon, authenticated;

create trigger workspace_members_audit
  after insert or update or delete on public.workspace_members
  for each row execute function public.audit_workspace_member_change();

create or replace function public.audit_invitation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, auth.uid(), 'invitation.created', 'invitation', new.id::text,
            jsonb_build_object('email', new.email, 'role', new.role));
    return new;
  else
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.workspace_id, auth.uid(), 'invitation.revoked', 'invitation', old.id::text,
              jsonb_build_object('email', old.email, 'role', old.role,
                                 'accepted', old.accepted_at is not null));
    end if;
    return old;
  end if;
end;
$$;

comment on function public.audit_invitation_change() is
  'invitations after insert/delete trigger: writes invitation.created / invitation.revoked audit events. Token is never logged.';

revoke all on function public.audit_invitation_change() from public, anon, authenticated;

create trigger invitations_audit
  after insert or delete on public.invitations
  for each row execute function public.audit_invitation_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations       enable row level security;
alter table public.audit_events      enable row level security;

-- Table privileges: nothing for anon; for authenticated only what the policies
-- below allow. service_role keeps its grants for Edge Functions.
revoke all on table public.profiles, public.workspaces, public.workspace_members,
               public.invitations, public.audit_events
  from public, anon, authenticated;

grant select                         on table public.profiles          to authenticated;
grant update (full_name, avatar_url) on table public.profiles          to authenticated;
grant select, insert, delete         on table public.workspaces        to authenticated;
grant update (name, slug)            on table public.workspaces        to authenticated;
grant select, insert, delete         on table public.workspace_members to authenticated;
grant update (role)                  on table public.workspace_members to authenticated;
grant select, insert, delete         on table public.invitations       to authenticated;
grant select                         on table public.audit_events      to authenticated;

-- profiles --------------------------------------------------------------------
create policy profiles_select_self_or_shared_workspace
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.shares_workspace_with(id)
  );

create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- workspaces ------------------------------------------------------------------
create policy workspaces_select_member
  on public.workspaces
  for select
  to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_insert_creator
  on public.workspaces
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy workspaces_update_owner_admin
  on public.workspaces
  for update
  to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]));

create policy workspaces_delete_owner
  on public.workspaces
  for delete
  to authenticated
  using (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- workspace_members -----------------------------------------------------------
create policy workspace_members_select_member
  on public.workspace_members
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- Owners and admins add members; only an owner may add another owner.
create policy workspace_members_insert_owner_admin
  on public.workspace_members
  for insert
  to authenticated
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and (
      role <> 'owner'
      or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    )
  );

-- Only owners change roles (column grant limits the update to `role`).
-- The last-owner trigger blocks demoting the final owner.
create policy workspace_members_update_owner
  on public.workspace_members
  for update
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]));

-- Owners remove anyone, admins remove non-owners, anyone may leave.
-- The last-owner trigger blocks removing the final owner.
create policy workspace_members_delete_owner_admin_or_self
  on public.workspace_members
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    or (
      public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[])
      and role <> 'owner'
    )
  );

-- invitations -----------------------------------------------------------------
create policy invitations_select_owner_admin
  on public.invitations
  for select
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Owners and admins invite; only an owner may invite as owner; invited_by is the caller.
create policy invitations_insert_owner_admin
  on public.invitations
  for insert
  to authenticated
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and invited_by = (select auth.uid())
    and (
      role <> 'owner'
      or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    )
  );

create policy invitations_delete_owner_admin
  on public.invitations
  for delete
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- audit_events ----------------------------------------------------------------
create policy audit_events_select_member
  on public.audit_events
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));
