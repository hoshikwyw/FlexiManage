-- Migration 007: plans, subscriptions, entitlements and server-side plan limits
-- (Phase 4, Epic C; Part 18a, 2026-11-05)
--
-- Tables:    plans (global catalogue: Free, Pro, Business from docs/PLANNING.md
--            section 8), subscriptions (one per workspace, provider `manual`)
-- Enum:      subscription_status (active, past_due, canceled)
-- Functions: workspace_effective_plan, entitlement_usage,
--            entitlement_check_bypassed, owned_workspace_allowance (internal,
--            no API role), check_entitlement, check_workspace_entitlement (the
--            limit checks, no API role), enforce_entitlement,
--            enforce_workspace_entitlement, handle_workspace_subscription,
--            audit_subscription_change (triggers), workspace_entitlements
--            (authenticated), change_workspace_plan (service_role)
--
-- Entitlements are not a table. The effective limits of a workspace are the
-- limit columns of its plan (workspace_effective_plan: the subscription's plan
-- while the status is active or past_due, Free otherwise or without a row), and
-- usage is counted live from the tenant tables (entitlement_usage) inside the
-- same transaction as the insert, after a per-workspace, per-resource advisory
-- lock. Live counts cannot drift: every delete path (record delete, module and
-- workspace cascades, attachment row delete, reconciliation rejection, sweep,
-- member removal, invitation revoke, invitation expiry) frees capacity without
-- a trigger keeping a counter in step. There is therefore no usage_counters
-- table. workspace_usage() (004/005/006) is unchanged: it serves the usage page
-- and requires the caller to be a member, which the check cannot (an invitee
-- accepting an invitation is not a member yet), and its members/storage
-- semantics differ from the enforced ones (see entitlement_usage).
--
-- Error contract C6 (docs/architecture.md): a refused insert raises SQLSTATE
-- PT402 (PostgREST answers HTTP 402) with message `plan_limit_exceeded` and
-- DETAIL a JSON object {"resource", "limit", "current", "plan"}.
--
-- Downgrades never delete data (rule 9): an over-limit workspace keeps
-- everything; only new inserts of the over-limit resource are refused. Updates
-- and deletes are never checked.
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
create type public.subscription_status as enum ('active', 'past_due', 'canceled');

comment on type public.subscription_status is
  'Billing state of a subscription. active and past_due grant the plan''s limits (past_due is a grace state); canceled falls back to Free.';

-- ---------------------------------------------------------------------------
-- plans (global catalogue, not tenant-owned)
-- ---------------------------------------------------------------------------
create table public.plans (
  key                text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name               text not null check (char_length(name) between 1 and 50),
  price_cents        integer not null check (price_cents >= 0),
  currency           text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  billing_interval   text not null default 'month' check (billing_interval in ('month', 'year')),
  active             boolean not null default true,
  position           integer not null default 0,
  max_workspaces     integer not null check (max_workspaces >= 0),
  max_members        integer not null check (max_members >= 0),
  max_modules        integer not null check (max_modules >= 0),
  max_records        integer not null check (max_records >= 0),
  max_storage_bytes  bigint  not null check (max_storage_bytes >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.plans is
  'Plan catalogue (pricing hypotheses, docs/PLANNING.md section 8). Readable by every signed-in user; written only by migrations and operators (postgres).';
comment on column public.plans.key is 'Stable identifier: free, pro, business.';
comment on column public.plans.price_cents is 'Price per billing_interval in the smallest currency unit (900 = $9.00).';
comment on column public.plans.active is 'False hides a plan from new sales; workspaces already on it keep its limits.';
comment on column public.plans.max_workspaces is
  'Workspaces a user may own. Allowed count for a user = the highest max_workspaces among the effective plans of the workspaces they own, Free when they own none.';
comment on column public.plans.max_members is 'Memberships plus pending (unaccepted, unexpired) invitations per workspace.';
comment on column public.plans.max_storage_bytes is
  'Sum of declared attachments.size_bytes of uploaded and in-flight (pending < 1 hour) rows. Binary units: 50 MB = 52428800.';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

insert into public.plans
  (key, name, price_cents, currency, billing_interval, active, position,
   max_workspaces, max_members, max_modules, max_records, max_storage_bytes)
values
  ('free',     'Free',        0, 'USD', 'month', true, 0, 1,  2,  1,    200,    52428800),
  ('pro',      'Pro',       900, 'USD', 'month', true, 1, 1,  5,  5,   5000,  1073741824),
  ('business', 'Business', 2900, 'USD', 'month', true, 2, 3, 20, 20,  50000, 10737418240);

-- ---------------------------------------------------------------------------
-- subscriptions (one per workspace)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null unique references public.workspaces (id) on delete cascade,
  plan_key                  text not null default 'free' references public.plans (key),
  status                    public.subscription_status not null default 'active',
  provider                  text not null default 'manual' check (provider in ('manual')),
  provider_customer_id      text check (provider_customer_id is null or char_length(provider_customer_id) between 1 and 255),
  provider_subscription_id  text check (provider_subscription_id is null or char_length(provider_subscription_id) between 1 and 255),
  current_period_end        timestamptz,
  created_by                uuid default auth.uid() references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index subscriptions_plan_key_idx on public.subscriptions (plan_key);

comment on table public.subscriptions is
  'Billing state of a workspace: exactly one row per workspace (unique workspace_id, which is also its index), created with the workspace on Free by handle_workspace_subscription(). Members read it; nobody but change_workspace_plan() and operators writes it.';
comment on column public.subscriptions.provider is
  'Billing provider. Only manual (operator-managed) until decision D3; the provider ids stay null.';
comment on column public.subscriptions.status is
  'active and past_due grant plan_key''s limits; canceled falls back to Free (workspace_effective_plan).';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Backfill: every existing workspace starts on Free, managed manually. Rule 9:
-- a workspace already above a Free limit keeps all of its data.
insert into public.subscriptions (workspace_id, plan_key, status, provider, created_by)
select w.id, 'free', 'active', 'manual', w.created_by
from public.workspaces w
on conflict (workspace_id) do nothing;

-- New workspaces get their Free subscription in the same transaction.
create or replace function public.handle_workspace_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (workspace_id, plan_key, status, provider, created_by)
  values (new.id, 'free', 'active', 'manual', new.created_by)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

comment on function public.handle_workspace_subscription() is
  'workspaces after-insert trigger: creates the workspace''s Free / active / manual subscription in the same transaction.';

revoke all on function public.handle_workspace_subscription() from public, anon, authenticated, service_role;

create trigger workspaces_create_subscription
  after insert on public.workspaces
  for each row execute function public.handle_workspace_subscription();

-- ---------------------------------------------------------------------------
-- Audit: subscription.plan_changed / subscription.status_changed
-- ---------------------------------------------------------------------------
-- Every plan change, whichever path it takes (change_workspace_plan(), the
-- change-plan Edge Function, Studio), writes the event. Actor: auth.uid(), else
-- the transaction-local app.audit_actor_id that change_workspace_plan() sets
-- from its p_actor_id (Part 18c: the platform admin), else null (operator).
create or replace function public.audit_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('app.audit_actor_id', true), '')::uuid);
begin
  if new.plan_key is distinct from old.plan_key then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, v_actor, 'subscription.plan_changed', 'subscription', new.id::text,
            jsonb_build_object('from', old.plan_key, 'to', new.plan_key));
  end if;
  if new.status is distinct from old.status then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, v_actor, 'subscription.status_changed', 'subscription', new.id::text,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

comment on function public.audit_subscription_change() is
  'subscriptions after-update trigger: writes subscription.plan_changed { from, to } and subscription.status_changed { from, to }. Actor: auth.uid(), else app.audit_actor_id, else null.';

revoke all on function public.audit_subscription_change() from public, anon, authenticated, service_role;

create trigger subscriptions_audit
  after update on public.subscriptions
  for each row execute function public.audit_subscription_change();

-- ---------------------------------------------------------------------------
-- Internal helpers (security definer, no API role may call them)
-- ---------------------------------------------------------------------------
-- The plan whose limits apply: the subscription's plan while active or
-- past_due; Free when canceled or when no subscription row exists.
create or replace function public.workspace_effective_plan(p_workspace_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.plans p
  where p.key = coalesce(
    (select s.plan_key
     from public.subscriptions s
     where s.workspace_id = p_workspace_id
       and s.status in ('active', 'past_due')),
    'free');
$$;

comment on function public.workspace_effective_plan(uuid) is
  'Plan row whose limits apply to the workspace: the subscription''s plan when status is active or past_due, else Free (also without a subscription). Internal.';

-- Enforced usage per resource. Differs from workspace_usage() on purpose:
--   members        memberships + pending invitations (accepted_at null and
--                  expires_at in the future): an invitation reserves a seat
--   modules        modules rows
--   records        records rows
--   storage_bytes  declared size_bytes of uploaded rows and of rows still in
--                  flight (pending, younger than one hour, the same window as
--                  the per-record cap), so parallel uploads cannot overshoot
create or replace function public.entitlement_usage(p_workspace_id uuid, p_resource text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_resource
    when 'members' then
      return (select count(*) from public.workspace_members m where m.workspace_id = p_workspace_id)
           + (select count(*) from public.invitations i
              where i.workspace_id = p_workspace_id
                and i.accepted_at is null
                and i.expires_at > now());
    when 'modules' then
      return (select count(*) from public.modules m where m.workspace_id = p_workspace_id);
    when 'records' then
      return (select count(*) from public.records r where r.workspace_id = p_workspace_id);
    when 'storage_bytes' then
      return (select coalesce(sum(a.size_bytes), 0) from public.attachments a
              where a.workspace_id = p_workspace_id
                and (a.uploaded_at is not null or a.created_at > now() - interval '1 hour'));
    else
      raise exception 'entitlement_usage: unknown resource %', p_resource
        using errcode = 'invalid_parameter_value';
  end case;
end;
$$;

comment on function public.entitlement_usage(uuid, text) is
  'Enforced usage of a resource (members incl. pending unexpired invitations, modules, records, storage_bytes of uploaded and in-flight attachments). Internal; counted live, never cached.';

-- Seed and operator bypass: a session that is postgres or supabase_admin and
-- has not switched role (SET ROLE / PostgREST) is not checked. This covers
-- `supabase db reset` seeding, psql/Studio operator work and test fixtures.
-- Security definer functions do not change the `role` setting, so a user
-- reaching an insert through accept_invitation() or handle_new_workspace() is
-- still checked; service_role (Edge Functions) is always checked.
create or replace function public.entitlement_check_bypassed()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (case when coalesce(current_setting('role', true), 'none') = 'none'
               then session_user::text
               else current_setting('role', true) end)
         in ('postgres', 'supabase_admin');
$$;

comment on function public.entitlement_check_bypassed() is
  'True when the session acts as postgres or supabase_admin without SET ROLE (seed, operators, fixtures): plan limits are not checked. API roles (authenticated, service_role) are always checked. Internal.';

-- Workspace allowance of a user: owned = workspaces where they are owner;
-- allowed = the highest max_workspaces among the effective plans of those
-- workspaces, Free when they own none; plan = the plan granting it.
create or replace function public.owned_workspace_allowance(p_user_id uuid)
returns table (plan_key text, max_workspaces integer, owned bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with owned as (
    select m.workspace_id
    from public.workspace_members m
    where m.user_id = p_user_id
      and m.role = 'owner'
  ),
  best as (
    select p.key, p.max_workspaces
    from owned o
    cross join lateral public.workspace_effective_plan(o.workspace_id) p
    order by p.max_workspaces desc nulls last, p.position desc
    limit 1
  )
  select coalesce(b.key, f.key),
         coalesce(b.max_workspaces, f.max_workspaces),
         (select count(*) from owned)
  from public.plans f
  left join best b on true
  where f.key = 'free';
$$;

comment on function public.owned_workspace_allowance(uuid) is
  'Workspaces the user owns and may own: allowed = max(max_workspaces) over the effective plans of the owned workspaces, Free when none; plan_key = the plan granting it. Internal.';

revoke all on function public.workspace_effective_plan(uuid) from public, anon, authenticated, service_role;
revoke all on function public.entitlement_usage(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.entitlement_check_bypassed() from public, anon, authenticated, service_role;
revoke all on function public.owned_workspace_allowance(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_entitlement / check_workspace_entitlement (contract C6)
-- ---------------------------------------------------------------------------
-- Volatile on purpose: each statement takes a fresh snapshot after the lock,
-- so the count includes everything committed by the transaction that held the
-- lock before (same pattern as enforce_attachment_cap(), migration 006). Rows
-- inserted earlier by the same statement are visible too, so a multi-row
-- insert is refused as a whole once one row crosses the limit.
create or replace function public.check_entitlement(
  p_workspace_id uuid,
  p_resource text,
  p_delta bigint default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan    public.plans;
  v_limit   bigint;
  v_current bigint;
begin
  if p_resource is null or p_resource not in ('members', 'modules', 'records', 'storage_bytes') then
    raise exception 'check_entitlement: unknown resource %', p_resource
      using errcode = 'invalid_parameter_value';
  end if;
  if p_delta is null or p_delta < 0 then
    raise exception 'check_entitlement: p_delta must be >= 0'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_workspace_id is null or public.entitlement_check_bypassed() then
    return;
  end if;

  -- Serialise inserts of one resource per workspace: two transactions cannot
  -- both take the last slot. Held until commit or rollback.
  perform pg_advisory_xact_lock(hashtext('entitlement:' || p_resource || ':' || p_workspace_id::text));

  v_plan := public.workspace_effective_plan(p_workspace_id);
  v_limit := case p_resource
               when 'members'       then v_plan.max_members
               when 'modules'       then v_plan.max_modules
               when 'records'       then v_plan.max_records
               when 'storage_bytes' then v_plan.max_storage_bytes
             end;
  v_current := public.entitlement_usage(p_workspace_id, p_resource);

  if v_current + p_delta > v_limit then
    raise exception 'plan_limit_exceeded'
      using errcode = 'PT402',
            detail = jsonb_build_object('resource', p_resource, 'limit', v_limit,
                                        'current', v_current, 'plan', v_plan.key)::text,
            hint = 'Upgrade the plan or remove items to free capacity. Existing data is kept.';
  end if;
end;
$$;

comment on function public.check_entitlement(uuid, text, bigint) is
  'Contract C6: raises PT402 plan_limit_exceeded with DETAIL {"resource","limit","current","plan"} when usage + p_delta exceeds the effective plan''s limit for members, modules, records or storage_bytes. Per-workspace, per-resource advisory lock. Skipped for postgres/supabase_admin sessions (entitlement_check_bypassed). Called from insert triggers only.';

create or replace function public.check_workspace_entitlement(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allow record;
begin
  if p_owner_id is null or public.entitlement_check_bypassed() then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('entitlement:workspaces:' || p_owner_id::text));

  select a.plan_key, a.max_workspaces, a.owned into v_allow
  from public.owned_workspace_allowance(p_owner_id) a;

  if v_allow.owned + 1 > v_allow.max_workspaces then
    raise exception 'plan_limit_exceeded'
      using errcode = 'PT402',
            detail = jsonb_build_object('resource', 'workspaces', 'limit', v_allow.max_workspaces,
                                        'current', v_allow.owned, 'plan', v_allow.plan_key)::text,
            hint = 'Upgrade one of your workspaces to a plan that allows more workspaces.';
  end if;
end;
$$;

comment on function public.check_workspace_entitlement(uuid) is
  'Contract C6 for workspace creation: raises PT402 plan_limit_exceeded with DETAIL {"resource":"workspaces","limit","current","plan"} when the user already owns as many workspaces as owned_workspace_allowance() allows. Per-user advisory lock. Skipped for postgres/supabase_admin sessions.';

revoke all on function public.check_entitlement(uuid, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.check_workspace_entitlement(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Insert triggers
-- ---------------------------------------------------------------------------
-- Named *_check_entitlement so they fire before the other before-insert
-- triggers (alphabetical order): the entitlement lock is always taken before
-- the per-record attachment lock and the module row lock.
create or replace function public.enforce_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_delta bigint := 1;
begin
  if new.workspace_id is null then
    return new;  -- the not-null constraint answers
  end if;

  if tg_table_name = 'workspace_members' then
    -- Only reachable through handle_new_workspace() and accept_invitation()
    -- (no client insert grant). A join that consumes a pending invitation
    -- takes the seat the invitation reserved (delta 0), but is still refused
    -- when the workspace is over its member limit, e.g. after a downgrade
    -- between invitation and acceptance.
    select lower(trim(u.email)) into v_email from auth.users u where u.id = new.user_id;
    if v_email is not null and exists (
      select 1 from public.invitations i
      where i.workspace_id = new.workspace_id
        and i.accepted_at is null
        and i.expires_at > now()
        and lower(trim(i.email)) = v_email
    ) then
      v_delta := 0;
    end if;
    perform public.check_entitlement(new.workspace_id, 'members', v_delta);
    return new;
  end if;

  -- Client-writable tables: RLS evaluates its with check after the before
  -- triggers. A signed-in caller the insert policy refuses anyway (not a
  -- member; for invitations and modules not an owner or admin) is left to RLS:
  -- the answer stays the permission error and never reveals the workspace's
  -- plan or usage to a non-member.
  if auth.uid() is not null and (
       (tg_table_name in ('invitations', 'modules')
        and not public.has_workspace_role(new.workspace_id, array['owner', 'admin']::public.workspace_role[]))
       or not public.is_workspace_member(new.workspace_id)
     ) then
    return new;
  end if;

  case tg_table_name
    when 'invitations' then
      perform public.check_entitlement(new.workspace_id, 'members', 1);
    when 'modules' then
      perform public.check_entitlement(new.workspace_id, 'modules', 1);
    when 'records' then
      perform public.check_entitlement(new.workspace_id, 'records', 1);
    when 'attachments' then
      perform public.check_entitlement(new.workspace_id, 'storage_bytes', greatest(coalesce(new.size_bytes, 0), 0));
    else
      raise exception 'enforce_entitlement: unexpected table %', tg_table_name;
  end case;
  return new;
end;
$$;

comment on function public.enforce_entitlement() is
  'Before-insert trigger on workspace_members, invitations, modules, records and attachments: check_entitlement() for members (memberships: delta 0 when a pending invitation for the user''s email exists), modules, records and storage_bytes (delta = size_bytes). Skipped for signed-in callers the insert policy refuses anyway (non-members; non-owner/admin for invitations and modules), so RLS answers and no usage is disclosed.';

create or replace function public.enforce_workspace_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- created_by null: handle_new_workspace() raises. Someone else's id: the
  -- insert policy refuses it; do not disclose that user's workspace count.
  if new.created_by is null
     or (auth.uid() is not null and new.created_by <> auth.uid()) then
    return new;
  end if;
  perform public.check_workspace_entitlement(new.created_by);
  return new;
end;
$$;

comment on function public.enforce_workspace_entitlement() is
  'workspaces before-insert trigger: check_workspace_entitlement(created_by). Skipped when created_by is null or not the caller (RLS / handle_new_workspace answer).';

revoke all on function public.enforce_entitlement() from public, anon, authenticated, service_role;
revoke all on function public.enforce_workspace_entitlement() from public, anon, authenticated, service_role;

create trigger workspaces_check_entitlement
  before insert on public.workspaces
  for each row execute function public.enforce_workspace_entitlement();

create trigger workspace_members_check_entitlement
  before insert on public.workspace_members
  for each row execute function public.enforce_entitlement();

create trigger invitations_check_entitlement
  before insert on public.invitations
  for each row execute function public.enforce_entitlement();

create trigger modules_check_entitlement
  before insert on public.modules
  for each row execute function public.enforce_entitlement();

create trigger records_check_entitlement
  before insert on public.records
  for each row execute function public.enforce_entitlement();

create trigger attachments_check_entitlement
  before insert on public.attachments
  for each row execute function public.enforce_entitlement();

-- ---------------------------------------------------------------------------
-- workspace_entitlements: limits and enforced usage for the usage page
-- ---------------------------------------------------------------------------
create or replace function public.workspace_entitlements(p_workspace_id uuid)
returns table (
  resource       text,
  plan           text,
  limit_value    bigint,
  current_value  bigint,
  over_limit     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan  public.plans;
  v_allow record;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace'
      using errcode = 'insufficient_privilege';
  end if;

  v_plan := public.workspace_effective_plan(p_workspace_id);
  select a.plan_key, a.max_workspaces, a.owned into v_allow
  from public.owned_workspace_allowance(auth.uid()) a;

  return query
    select r.resource, r.plan, r.limit_value, r.current_value, r.current_value > r.limit_value
    from (values
      ('members',       v_plan.key, v_plan.max_members::bigint,  public.entitlement_usage(p_workspace_id, 'members'),       1),
      ('modules',       v_plan.key, v_plan.max_modules::bigint,  public.entitlement_usage(p_workspace_id, 'modules'),       2),
      ('records',       v_plan.key, v_plan.max_records::bigint,  public.entitlement_usage(p_workspace_id, 'records'),       3),
      ('storage_bytes', v_plan.key, v_plan.max_storage_bytes,    public.entitlement_usage(p_workspace_id, 'storage_bytes'), 4),
      ('workspaces',    v_allow.plan_key::text, v_allow.max_workspaces::bigint, v_allow.owned::bigint,                     5)
    ) as r(resource, plan, limit_value, current_value, ord)
    order by r.ord;
end;
$$;

comment on function public.workspace_entitlements(uuid) is
  'One row per resource (members, modules, records, storage_bytes, workspaces) with the effective plan, limit, enforced usage and over_limit (usage > limit, e.g. after a downgrade). The workspaces row is about the caller: workspaces they own vs. allowed. Caller must be a member (else 42501).';

revoke all on function public.workspace_entitlements(uuid) from public, anon;
grant execute on function public.workspace_entitlements(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- change_workspace_plan: operator plan change (change-plan Edge Function)
-- ---------------------------------------------------------------------------
-- Moves the workspace to p_plan_key and sets the status to active. Downgrades
-- are allowed when the workspace is over the new limits; nothing is deleted
-- and over_limit lists the resources now above their limit. Takes the four
-- resource locks of the workspace (fixed order) so inserts racing the change
-- are checked against either the old or the new plan, never a mix. The audit
-- event is written by audit_subscription_change(); p_actor_id (trusted:
-- service_role only) becomes its actor_id when there is no auth.uid().
create or replace function public.change_workspace_plan(
  p_workspace_id uuid,
  p_plan_key text,
  p_actor_id uuid default null
)
returns table (
  workspace_id  uuid,
  from_plan     text,
  to_plan       text,
  changed       boolean,
  over_limit    text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub     public.subscriptions;
  v_plan    public.plans;
  v_res     text;
  v_over    text[] := '{}';
begin
  select p.* into v_plan from public.plans p where p.key = p_plan_key and p.active;
  if not found then
    raise exception 'unknown_plan'
      using errcode = 'invalid_parameter_value',
            detail = jsonb_build_object('plan', p_plan_key)::text;
  end if;

  if p_workspace_id is null
     or not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    raise exception 'workspace_not_found' using errcode = 'PT404';
  end if;

  foreach v_res in array array['members', 'modules', 'records', 'storage_bytes'] loop
    perform pg_advisory_xact_lock(hashtext('entitlement:' || v_res || ':' || p_workspace_id::text));
  end loop;

  insert into public.subscriptions (workspace_id, plan_key, status, provider)
  values (p_workspace_id, 'free', 'active', 'manual')
  on conflict on constraint subscriptions_workspace_id_key do nothing;

  select s.* into v_sub
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
  for update;

  workspace_id := p_workspace_id;
  from_plan    := v_sub.plan_key;
  to_plan      := v_plan.key;
  changed      := v_sub.plan_key <> v_plan.key or v_sub.status <> 'active';

  if changed then
    perform set_config('app.audit_actor_id', coalesce(p_actor_id::text, ''), true);
    update public.subscriptions s
       set plan_key = v_plan.key,
           status   = 'active'
     where s.id = v_sub.id;
    perform set_config('app.audit_actor_id', '', true);
  end if;

  if public.entitlement_usage(p_workspace_id, 'members') > v_plan.max_members then
    v_over := v_over || 'members'::text;
  end if;
  if public.entitlement_usage(p_workspace_id, 'modules') > v_plan.max_modules then
    v_over := v_over || 'modules'::text;
  end if;
  if public.entitlement_usage(p_workspace_id, 'records') > v_plan.max_records then
    v_over := v_over || 'records'::text;
  end if;
  if public.entitlement_usage(p_workspace_id, 'storage_bytes') > v_plan.max_storage_bytes then
    v_over := v_over || 'storage_bytes'::text;
  end if;
  over_limit := v_over;
  return next;
end;
$$;

comment on function public.change_workspace_plan(uuid, text, uuid) is
  'Operator plan change: sets the subscription to p_plan_key (active plan only, else 22023 unknown_plan) with status active; PT404 workspace_not_found. Never deletes data; over_limit lists resources above the new limits. Audited by audit_subscription_change() (subscription.plan_changed { from, to }), actor p_actor_id. service_role only.';

revoke all on function public.change_workspace_plan(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.change_workspace_plan(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.plans         enable row level security;
alter table public.subscriptions enable row level security;

revoke all on table public.plans, public.subscriptions from public, anon, authenticated;

grant select on table public.plans         to authenticated;
grant select on table public.subscriptions to authenticated;

-- plans: global catalogue, every signed-in user reads it; no client writes.
create policy plans_select_authenticated
  on public.plans
  for select
  to authenticated
  using (true);

-- subscriptions: members read their workspace's row; no client writes
-- (insert/update/delete have neither a grant nor a policy).
create policy subscriptions_select_member
  on public.subscriptions
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));
