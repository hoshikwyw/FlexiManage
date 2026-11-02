-- Migration 003: Phase 2 review fixes (review round 1, 2026-10-30)
--
-- Changes (all on tables and functions from migrations 001 and 002):
--   1. invitations: authenticated may insert only (workspace_id, email, role,
--      invited_by); email must look like an address; at most one pending
--      invitation per (workspace, lower(email)).
--   2. invitations: the token column is hidden from authenticated (column-level
--      select grant). Only accept_invitation() reads it.
--   3. workspace_members: direct inserts by authenticated are removed. The only
--      paths into a workspace are the workspace creation trigger and
--      accept_invitation(), both security definer.
--   4. protect_last_owner(): per-workspace advisory lock so two concurrent
--      demotions/removals cannot both see "one other owner remains".
--   5. Account deletion: a before-delete trigger on auth.users promotes a
--      successor owner (earliest admin, else earliest member) in every workspace
--      the user solely owned, or deletes the workspace when the user was its only
--      member. The guard lets the cascade of a deleted auth.users row through.
--   6. profiles.email follows auth.users.email; handle_new_user() truncates
--      full_name to 100 chars and drops avatar URLs that fail the new check.
--   7. profiles: named checks on full_name (<= 100) and avatar_url (https, <= 2048).
--   8. Audit privacy: invitation events carry invitation_id and role, never the
--      invitee's email.
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

-- ---------------------------------------------------------------------------
-- 1. invitations: insert surface, email format, one pending per address
-- ---------------------------------------------------------------------------
revoke insert on public.invitations from authenticated;
grant insert (workspace_id, email, role, invited_by) on public.invitations to authenticated;

alter table public.invitations
  add constraint invitations_email_format_check
  check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

comment on constraint invitations_email_format_check on public.invitations is
  'Loose address shape: one @, no whitespace, a dot in the domain. Full validation is in the invite-member function.';

create unique index invitations_pending_unique
  on public.invitations (workspace_id, lower(email))
  where accepted_at is null;

comment on index public.invitations_pending_unique is
  'One pending (not yet accepted) invitation per workspace and address, case-insensitive. Expired rows still count: invite-member deletes them before re-inviting.';

-- ---------------------------------------------------------------------------
-- 2. invitations: hide the token from API clients
-- ---------------------------------------------------------------------------
revoke select on public.invitations from authenticated;
grant select (id, workspace_id, email, role, invited_by, expires_at, accepted_at, created_at)
  on public.invitations to authenticated;

comment on column public.invitations.token is
  '64 hex chars (32 random bytes). Not selectable by authenticated (column grant); read only by accept_invitation() and, for delivery, by Edge Functions with the service role.';

-- ---------------------------------------------------------------------------
-- 3. workspace_members: no direct inserts (invitation acceptance is the only path)
-- ---------------------------------------------------------------------------
revoke insert on public.workspace_members from authenticated;
drop policy workspace_members_insert_owner_admin on public.workspace_members;

comment on table public.workspace_members is
  'Membership of a user in a workspace with a role. The source of truth for every RLS decision. Rows are created only by handle_new_workspace() (creator becomes owner) and accept_invitation().';

-- ---------------------------------------------------------------------------
-- 4 + 5a. Last-owner guard: advisory lock, account-deletion cascade exemption
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

  -- Cascade from deleting the auth.users row: handle_user_deleted() has already
  -- promoted a successor or deleted the workspace; the membership must go.
  if tg_op = 'DELETE'
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  -- Serialise owner changes per workspace: two transactions each removing one of
  -- two owners would otherwise both count the other as "remaining".
  perform pg_advisory_xact_lock(hashtext('workspace_members:' || old.workspace_id::text));

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
  'workspace_members before update/delete trigger: rejects a change that would leave a workspace with zero owners. Takes a per-workspace advisory lock; lets the cascades from a deleted workspace or a deleted auth.users row through.';

-- ---------------------------------------------------------------------------
-- 5b. Account deletion: succession before the memberships cascade
-- ---------------------------------------------------------------------------
-- Runs before the auth.users row is deleted, while the memberships still exist
-- (the FK cascade on workspace_members.user_id fires after the row is gone).
-- For every workspace the user is the only owner of:
--   * promote the earliest-joined admin, else the earliest-joined member, to
--     owner (the membership trigger writes member.role_changed; actor_id is
--     auth.uid(), which is null when GoTrue or the service role deletes the user);
--   * when nobody else is a member, delete the workspace. Its memberships,
--     invitations and audit events cascade with it (same as an owner-initiated
--     delete), so no workspace.deleted row survives.
-- The user's own memberships are then removed by the FK cascade and audited as
-- member.removed by the existing trigger.
create or replace function public.handle_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws        record;
  v_successor uuid;
begin
  for v_ws in
    select m.workspace_id
    from public.workspace_members m
    where m.user_id = old.id
      and m.role = 'owner'
    order by m.workspace_id
  loop
    -- Same lock as protect_last_owner(): no concurrent owner change slips between
    -- the count and the decision below.
    perform pg_advisory_xact_lock(hashtext('workspace_members:' || v_ws.workspace_id::text));

    if exists (
      select 1 from public.workspace_members m
      where m.workspace_id = v_ws.workspace_id
        and m.role = 'owner'
        and m.user_id <> old.id
    ) then
      continue;  -- another owner remains; the cascade just removes this membership
    end if;

    select m.user_id into v_successor
    from public.workspace_members m
    where m.workspace_id = v_ws.workspace_id
      and m.user_id <> old.id
    order by (m.role = 'admin') desc, m.created_at, m.user_id
    limit 1;

    if v_successor is not null then
      update public.workspace_members m
         set role = 'owner'
       where m.workspace_id = v_ws.workspace_id
         and m.user_id = v_successor;
    else
      delete from public.workspaces w where w.id = v_ws.workspace_id;
    end if;
  end loop;

  return old;
end;
$$;

comment on function public.handle_user_deleted() is
  'auth.users before-delete trigger: in every workspace the user solely owned, promotes the earliest admin (else earliest member) to owner, or deletes the workspace when the user was its only member.';

revoke all on function public.handle_user_deleted() from public, anon, authenticated;

create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function public.handle_user_deleted();

-- ---------------------------------------------------------------------------
-- 6. profiles follow auth.users: bounded full_name at signup, email sync
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avatar text := new.raw_user_meta_data ->> 'avatar_url';
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    left(new.raw_user_meta_data ->> 'full_name', 100),
    case
      when v_avatar ~ '^https://' and char_length(v_avatar) <= 2048 then v_avatar
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users after-insert trigger: creates the matching public.profiles row (full_name truncated to 100 chars, avatar_url only when it satisfies profiles_avatar_url_check). Security definer because the auth admin role has no privileges on public.';

create or replace function public.handle_user_email_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set email = coalesce(new.email, '')
   where p.id = new.id
     and p.email is distinct from coalesce(new.email, '');
  return new;
end;
$$;

comment on function public.handle_user_email_changed() is
  'auth.users after-update-of-email trigger: mirrors the new address into public.profiles.email.';

revoke all on function public.handle_user_email_changed() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_changed();

-- ---------------------------------------------------------------------------
-- 7. profiles bounds
-- ---------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_full_name_length_check
  check (char_length(full_name) <= 100);

alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048));

-- ---------------------------------------------------------------------------
-- 8. Audit privacy: invitation events never carry the invitee's email
-- ---------------------------------------------------------------------------
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
            jsonb_build_object('invitation_id', new.id, 'role', new.role));
    return new;
  else
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.workspace_id, auth.uid(), 'invitation.revoked', 'invitation', old.id::text,
              jsonb_build_object('invitation_id', old.id, 'role', old.role,
                                 'accepted', old.accepted_at is not null));
    end if;
    return old;
  end if;
end;
$$;

comment on function public.audit_invitation_change() is
  'invitations after insert/delete trigger: writes invitation.created / invitation.revoked audit events with invitation_id and role. Neither the token nor the invitee email is logged.';

create or replace function public.accept_invitation(p_token text)
returns table (
  workspace_id    uuid,
  workspace_name  text,
  workspace_slug  text,
  role            public.workspace_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id          uuid := auth.uid();
  v_user_email       text;
  v_email_confirmed  timestamptz;
  v_inv              public.invitations%rowtype;
  v_ws               public.workspaces%rowtype;
  v_existing_role    public.workspace_role;
  v_already_member   boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = 'PT401';
  end if;

  select u.email, u.email_confirmed_at
    into v_user_email, v_email_confirmed
  from auth.users u
  where u.id = v_user_id;

  if v_user_email is null then
    raise exception 'authentication required'
      using errcode = 'PT401';
  end if;

  -- Lock the row so two concurrent accepts of the same token serialise; the
  -- second one then sees accepted_at set and fails with PT404.
  select i.*
    into v_inv
  from public.invitations i
  where i.token = p_token
  for update;

  if not found or v_inv.accepted_at is not null then
    raise exception 'invitation not found or already used'
      using errcode = 'PT404';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'invitation has expired'
      using errcode = 'PT410',
            hint = 'Ask a workspace owner or admin to send a new invitation.';
  end if;

  if lower(trim(v_inv.email)) <> lower(trim(v_user_email)) then
    raise exception 'invitation was issued to a different email address'
      using errcode = 'PT403';
  end if;

  if v_email_confirmed is null then
    raise exception 'email address is not verified'
      using errcode = 'PT403',
            hint = 'Verify your email address, then accept the invitation again.';
  end if;

  select w.*
    into v_ws
  from public.workspaces w
  where w.id = v_inv.workspace_id;

  select m.role
    into v_existing_role
  from public.workspace_members m
  where m.workspace_id = v_inv.workspace_id
    and m.user_id = v_user_id;

  v_already_member := v_existing_role is not null;

  if not v_already_member then
    -- Fires workspace_members_audit -> member.added with auth.uid() as actor.
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_inv.workspace_id, v_user_id, v_inv.role);
    v_existing_role := v_inv.role;
  end if;
  -- Already a member: keep the existing role, just consume the invitation.

  update public.invitations i
     set accepted_at = now()
   where i.id = v_inv.id;

  -- Metadata never includes the invitee's email (privacy) nor the token.
  insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_inv.workspace_id,
    v_user_id,
    'invitation.accepted',
    'invitation',
    v_inv.id::text,
    jsonb_build_object(
      'invitation_id', v_inv.id,
      'role', v_inv.role,
      'already_member', v_already_member
    )
  );

  workspace_id   := v_ws.id;
  workspace_name := v_ws.name;
  workspace_slug := v_ws.slug;
  role           := v_existing_role;
  return next;
end;
$$;

comment on function public.accept_invitation(text) is
  'Accepts an invitation by token for auth.uid(): checks unused/unexpired/email match, inserts the membership, stamps accepted_at and writes invitation.accepted (invitation_id, role, already_member). Raises PT401/PT403/PT404/PT410.';
