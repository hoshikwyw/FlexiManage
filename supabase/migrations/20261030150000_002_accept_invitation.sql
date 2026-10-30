-- Migration 002: accept_invitation()
--
-- One security definer function that performs the whole invitation acceptance
-- in a single transaction: look the token up, check it is unused and not
-- expired, check that the caller owns the invited email address, insert the
-- membership (unless the caller is already a member), stamp accepted_at and
-- write the invitation.accepted audit event. The accept-invitation Edge
-- Function is a thin validated wrapper that calls it with the caller's JWT.
--
-- Identity: the caller is always auth.uid() from the verified JWT. The function
-- never accepts a user id or email as a parameter, so it cannot be used to
-- accept on someone else's behalf, not even by service_role (execute is
-- granted to authenticated only). The caller's email is read from auth.users,
-- not from the JWT email claim, because the claim can be stale after an email
-- change; the address must also be confirmed (email_confirmed_at), since an
-- invitation proves nothing about an unverified mailbox.
--
-- Errors use PostgREST HTTP-status SQLSTATEs so the status is right even when
-- the function is called through PostgREST directly:
--   PT401  not authenticated (auth.uid() is null or has no auth.users row)
--   PT404  token unknown, or already accepted (one-shot token; a second call
--          is a clean error, not an idempotent success)
--   PT410  invitation expired
--   PT403  invitation issued to a different email, or caller's email unverified
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

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

  insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_inv.workspace_id,
    v_user_id,
    'invitation.accepted',
    'invitation',
    v_inv.id::text,
    jsonb_build_object(
      'email', v_inv.email,
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
  'Accepts an invitation by token for auth.uid(): checks unused/unexpired/email match, inserts the membership, stamps accepted_at and writes invitation.accepted. Raises PT401/PT403/PT404/PT410.';

revoke all on function public.accept_invitation(text) from public, anon, service_role;
grant execute on function public.accept_invitation(text) to authenticated;
