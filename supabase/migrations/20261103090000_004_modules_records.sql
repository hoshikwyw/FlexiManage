-- Migration 004: core content model
--
-- Tables:    modules, field_definitions, records
-- Enum:      field_type (text, number, date, select, checkbox, currency)
-- Functions: jsonb_values_text, field_options_are_valid, field_settings_are_valid
--            (pure, immutable; used by a generated column and check constraints),
--            validate_record_custom_values, protect_field_definition,
--            handle_field_deleted, audit_module_change, audit_field_change
--            (triggers), workspace_usage (counts for the usage page and the
--            Phase 4 entitlement check).
-- Search:    records.search_vector (generated tsvector over title, status and
--            the custom values) with a GIN index; pg_trgm GIN index on title
--            for ILIKE.
--
-- Tenancy: every table carries workspace_id. field_definitions and records
-- also carry module_id, and the pair (module_id, workspace_id) is a composite
-- foreign key to modules (id, workspace_id), so a row can never point at a
-- module of another workspace even when RLS lets the workspace_id through.
--
-- Not in this migration: attachments and the storage bucket (Part 13), plan
-- limit enforcement (Phase 4; workspace_usage() is the hook), record-level
-- audit events (Phase 4 decision; volume).
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
create type public.field_type as enum ('text', 'number', 'date', 'select', 'checkbox', 'currency');

comment on type public.field_type is
  'Type of a custom field. Decides the JSON shape accepted in records.custom_values: text/select/date -> string, number/currency -> number, checkbox -> boolean.';

-- ---------------------------------------------------------------------------
-- Pure helpers (immutable, no table access)
-- ---------------------------------------------------------------------------
-- Text of every top-level string and number value of a JSON object, space
-- separated, for the records.search_vector generated column. Booleans, nulls,
-- nested arrays and objects are ignored. Non-object input yields ''.
create or replace function public.jsonb_values_text(p_values jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_values is null or jsonb_typeof(p_values) <> 'object' then ''
    else coalesce(
      (select string_agg(e.value #>> '{}', ' ' order by e.key)
       from jsonb_each(p_values) e
       where jsonb_typeof(e.value) in ('string', 'number')),
      '')
  end;
$$;

comment on function public.jsonb_values_text(jsonb) is
  'Space-separated text of the top-level string and number values of a JSON object (used by records.search_vector).';

-- options shape per field type:
--   select     non-empty array (<= 100) of {"value": string 1..100, "label": string 1..100}
--              with distinct values
--   any other  exactly []
create or replace function public.field_options_are_valid(p_type public.field_type, p_options jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_options is null or jsonb_typeof(p_options) <> 'array' then false
    when p_type <> 'select' then p_options = '[]'::jsonb
    else
      jsonb_array_length(p_options) between 1 and 100
      and not exists (
        select 1
        from jsonb_array_elements(p_options) o
        where jsonb_typeof(o) <> 'object'
           or jsonb_typeof(o -> 'value') is distinct from 'string'
           or jsonb_typeof(o -> 'label') is distinct from 'string'
           or char_length(o ->> 'value') not between 1 and 100
           or char_length(o ->> 'label') not between 1 and 100
      )
      and (select count(distinct o ->> 'value') from jsonb_array_elements(p_options) o)
          = jsonb_array_length(p_options)
  end;
$$;

comment on function public.field_options_are_valid(public.field_type, jsonb) is
  'Check for field_definitions.options: select needs 1..100 {value, label} objects with distinct values; every other type needs [].';

-- settings shape (minimal; unknown keys are allowed):
--   object always
--   currency.currency   optional ISO 4217 code, ^[A-Z]{3}$
--   number/currency.precision  optional integer 0..6
create or replace function public.field_settings_are_valid(p_type public.field_type, p_settings jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_settings is not null
    and jsonb_typeof(p_settings) = 'object'
    and (
      p_type <> 'currency'
      or p_settings -> 'currency' is null
      or (jsonb_typeof(p_settings -> 'currency') = 'string'
          and (p_settings ->> 'currency') ~ '^[A-Z]{3}$')
    )
    and (
      p_type not in ('number', 'currency')
      or p_settings -> 'precision' is null
      or (jsonb_typeof(p_settings -> 'precision') = 'number'
          and (p_settings ->> 'precision') ~ '^[0-6]$')
    );
$$;

comment on function public.field_settings_are_valid(public.field_type, jsonb) is
  'Check for field_definitions.settings: an object; currency.currency is an ISO 4217 code; number/currency.precision is an integer 0..6.';

-- These three are referenced by check constraints and a generated column, which
-- are evaluated with the privileges of the writing role. They are pure and
-- side-effect free, so the default public execute is kept on purpose.

-- ---------------------------------------------------------------------------
-- modules
-- ---------------------------------------------------------------------------
create table public.modules (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 100),
  slug          text not null
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 60),
  description   text check (description is null or char_length(description) <= 500),
  icon          text check (icon is null or char_length(icon) <= 50),
  position      integer not null default 0,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, slug),
  -- Target of the composite foreign keys below.
  unique (id, workspace_id)
);

create index modules_workspace_id_idx on public.modules (workspace_id);

comment on table public.modules is
  'A configurable entity type inside a workspace (e.g. Clients, Projects). Owns field_definitions and records.';
comment on column public.modules.slug is
  'URL-safe identifier, unique per workspace: lowercase letters, digits and single hyphens, 1..60 chars.';
comment on column public.modules.position is
  'Sort order in the navigation. Maintained by the client; no server-side renumbering.';
comment on column public.modules.created_by is
  'Defaults to auth.uid(); the insert policy requires it to equal the caller.';

create trigger modules_set_updated_at
  before update on public.modules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field_definitions
-- ---------------------------------------------------------------------------
create table public.field_definitions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  module_id     uuid not null references public.modules (id) on delete cascade,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  label         text not null check (char_length(label) between 1 and 100),
  type          public.field_type not null,
  required      boolean not null default false,
  position      integer not null default 0,
  options       jsonb not null default '[]'::jsonb,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (module_id, key),
  constraint field_definitions_module_workspace_fkey
    foreign key (module_id, workspace_id) references public.modules (id, workspace_id) on delete cascade,
  constraint field_definitions_options_check
    check (public.field_options_are_valid(type, options)),
  constraint field_definitions_settings_check
    check (public.field_settings_are_valid(type, settings))
);

create index field_definitions_workspace_id_idx on public.field_definitions (workspace_id);
create index field_definitions_module_position_idx on public.field_definitions (module_id, position);

comment on table public.field_definitions is
  'Custom field of a module. The key addresses the value inside records.custom_values. workspace_id is denormalised for RLS and tied to the module through the composite FK.';
comment on column public.field_definitions.key is
  'Immutable identifier used as the key in records.custom_values: ^[a-z][a-z0-9_]{0,49}$, unique per module.';
comment on column public.field_definitions.options is
  'select: [{"value": text, "label": text}, ...] (1..100, distinct values). Other types: [].';
comment on column public.field_definitions.settings is
  'Type-specific settings: {"currency": "EUR"} for currency, {"precision": 2} for number/currency. Unknown keys are kept.';

create trigger field_definitions_set_updated_at
  before update on public.field_definitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- records
-- ---------------------------------------------------------------------------
create table public.records (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  module_id      uuid not null references public.modules (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 200),
  status         text check (status is null or char_length(status) <= 50),
  custom_values  jsonb not null default '{}'::jsonb,
  search_vector  tsvector generated always as (
                   to_tsvector('simple'::regconfig,
                     coalesce(title, '') || ' ' || coalesce(status, '') || ' '
                     || public.jsonb_values_text(custom_values))
                 ) stored,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint records_module_workspace_fkey
    foreign key (module_id, workspace_id) references public.modules (id, workspace_id) on delete cascade
);

create index records_workspace_module_created_idx
  on public.records (workspace_id, module_id, created_at desc);
create index records_search_vector_idx
  on public.records using gin (search_vector);
create index records_custom_values_idx
  on public.records using gin (custom_values jsonb_path_ops);
create index records_title_trgm_idx
  on public.records using gin (title extensions.gin_trgm_ops);

comment on table public.records is
  'A row of a module: structured core (title, status) plus custom_values keyed by field_definitions.key. Validated by validate_record_custom_values().';
comment on column public.records.custom_values is
  'JSON object {field key: value}. Every key must be a field of the module; values are type-checked by the trigger. Null clears a non-required field.';
comment on column public.records.search_vector is
  'Generated: to_tsvector(simple) of title, status and the string/number custom values. Not writable; query with @@ to_tsquery(''simple'', ...).';

create trigger records_set_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Custom value validation
-- ---------------------------------------------------------------------------
-- Before insert, and before update of custom_values or module_id. Raises
-- check_violation (23514) with message
--   custom_values: expected object
--   custom_values.<key>: unknown field
--   custom_values.<key>: required
--   custom_values.<key>: expected string
--   custom_values.<key>: text longer than 2000 characters
--   custom_values.<key>: expected number
--   custom_values.<key>: expected date YYYY-MM-DD
--   custom_values.<key>: expected boolean
--   custom_values.<key>: not one of the options
-- Only the first failure is reported: unknown keys (alphabetical) first, then
-- the module's fields by position (required before type). Null is accepted for
-- a non-required field of any type and means "no value". A required field must
-- be present and neither null nor '' (checkbox: false is a value).
-- Skips nested invocations (pg_trigger_depth() > 1): the only one is the
-- key-strip update in handle_field_deleted(), whose result is valid by
-- construction and must not fail on a record that still lacks a later-added
-- required field.
create or replace function public.validate_record_custom_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key    text;
  v_field  record;
  v_value  jsonb;
  v_text   text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.custom_values is null or jsonb_typeof(new.custom_values) <> 'object' then
    raise exception 'custom_values: expected object'
      using errcode = 'check_violation', column = 'custom_values';
  end if;

  -- Unknown keys are an error, never silently dropped.
  select k into v_key
  from jsonb_object_keys(new.custom_values) k
  where not exists (
    select 1 from public.field_definitions f
    where f.module_id = new.module_id and f.key = k
  )
  order by k
  limit 1;
  if v_key is not null then
    raise exception 'custom_values.%: unknown field', v_key
      using errcode = 'check_violation', column = 'custom_values';
  end if;

  for v_field in
    select f.key, f.type, f.required, f.options
    from public.field_definitions f
    where f.module_id = new.module_id
    order by f.position, f.key
  loop
    v_value := new.custom_values -> v_field.key;

    if v_value is null or jsonb_typeof(v_value) = 'null'
       or (jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = '') then
      if v_field.required then
        raise exception 'custom_values.%: required', v_field.key
          using errcode = 'check_violation', column = 'custom_values';
      end if;
      continue;
    end if;

    case v_field.type
      when 'text' then
        if jsonb_typeof(v_value) <> 'string' then
          raise exception 'custom_values.%: expected string', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;
        if char_length(v_value #>> '{}') > 2000 then
          raise exception 'custom_values.%: text longer than 2000 characters', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;

      when 'number', 'currency' then
        if jsonb_typeof(v_value) <> 'number' then
          raise exception 'custom_values.%: expected number', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;

      when 'date' then
        v_text := v_value #>> '{}';
        if jsonb_typeof(v_value) <> 'string' or v_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'custom_values.%: expected date YYYY-MM-DD', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;
        begin
          perform v_text::date;
        exception when others then
          raise exception 'custom_values.%: expected date YYYY-MM-DD', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end;

      when 'checkbox' then
        if jsonb_typeof(v_value) <> 'boolean' then
          raise exception 'custom_values.%: expected boolean', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;

      when 'select' then
        if jsonb_typeof(v_value) <> 'string' then
          raise exception 'custom_values.%: expected string', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;
        if not exists (
          select 1 from jsonb_array_elements(v_field.options) o
          where o ->> 'value' = (v_value #>> '{}')
        ) then
          raise exception 'custom_values.%: not one of the options', v_field.key
            using errcode = 'check_violation', column = 'custom_values';
        end if;
    end case;
  end loop;

  return new;
end;
$$;

comment on function public.validate_record_custom_values() is
  'records before insert/update trigger: every key of custom_values must be a field of the module, required fields must be present, values must match the field type. Raises 23514 "custom_values.<key>: <reason>".';

revoke all on function public.validate_record_custom_values() from public, anon, authenticated;

create trigger records_validate_custom_values
  before insert or update of custom_values, module_id on public.records
  for each row execute function public.validate_record_custom_values();

-- ---------------------------------------------------------------------------
-- Field definition guards (before update)
-- ---------------------------------------------------------------------------
-- Raises check_violation (23514) with message
--   field_definitions.key: cannot be changed
--   field_definitions.type: cannot be changed while records have a value for "<key>"
--   field_definitions.options: option "<value>" is still used by records
-- Flipping required to true (or adding a required field) when records lack a
-- value is allowed: those records are re-validated on their next edit, which
-- is when the form asks for the value.
create or replace function public.protect_field_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used text;
begin
  if new.key <> old.key then
    raise exception 'field_definitions.key: cannot be changed'
      using errcode = 'check_violation', column = 'key',
            hint = 'Delete the field and create a new one.';
  end if;

  if new.type <> old.type and exists (
    select 1 from public.records r
    where r.module_id = old.module_id
      and r.custom_values -> old.key is not null
      and jsonb_typeof(r.custom_values -> old.key) <> 'null'
  ) then
    raise exception 'field_definitions.type: cannot be changed while records have a value for "%"', old.key
      using errcode = 'check_violation', column = 'type',
            hint = 'Clear the values first, or delete the field and create a new one.';
  end if;

  if new.type = 'select' and old.type = 'select' and new.options <> old.options then
    select r.custom_values ->> old.key into v_used
    from public.records r
    where r.module_id = old.module_id
      and jsonb_typeof(r.custom_values -> old.key) = 'string'
      and not exists (
        select 1 from jsonb_array_elements(new.options) o
        where o ->> 'value' = r.custom_values ->> old.key
      )
    limit 1;
    if v_used is not null then
      raise exception 'field_definitions.options: option "%" is still used by records', v_used
        using errcode = 'check_violation', column = 'options',
              hint = 'Change those records first, or keep the option.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_field_definition() is
  'field_definitions before update trigger: key is immutable; type cannot change while records hold a value; a select option in use cannot be removed. Raises 23514.';

revoke all on function public.protect_field_definition() from public, anon, authenticated;

create trigger field_definitions_protect
  before update on public.field_definitions
  for each row execute function public.protect_field_definition();

-- ---------------------------------------------------------------------------
-- Field deletion strips the key from the module's records
-- ---------------------------------------------------------------------------
-- After delete (not before): the definition is already gone, so the records'
-- remaining values validate against the remaining fields. Skipped during a
-- module or workspace cascade (the module row no longer exists; the records
-- are being deleted as well).
create or replace function public.handle_field_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.modules m where m.id = old.module_id) then
    return old;
  end if;

  update public.records r
     set custom_values = r.custom_values - old.key
   where r.module_id = old.module_id
     and r.custom_values ? old.key;

  return old;
end;
$$;

comment on function public.handle_field_deleted() is
  'field_definitions after delete trigger: removes the deleted key from custom_values of the module''s records so they stay valid.';

revoke all on function public.handle_field_deleted() from public, anon, authenticated;

create trigger field_definitions_strip_values
  after delete on public.field_definitions
  for each row execute function public.handle_field_deleted();

-- ---------------------------------------------------------------------------
-- Audit: modules and fields (not records; Phase 4 decision)
-- ---------------------------------------------------------------------------
create or replace function public.audit_module_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, auth.uid(), 'module.created', 'module', new.id::text,
            jsonb_build_object('name', new.name, 'slug', new.slug));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.name <> old.name or new.slug <> old.slug then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (new.workspace_id, auth.uid(), 'module.updated', 'module', new.id::text,
              jsonb_build_object(
                'from', jsonb_build_object('name', old.name, 'slug', old.slug),
                'to',   jsonb_build_object('name', new.name, 'slug', new.slug)));
    end if;
    return new;
  else
    -- Skip when the workspace itself is being deleted (cascade); the FK would fail.
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.workspace_id, auth.uid(), 'module.deleted', 'module', old.id::text,
              jsonb_build_object('name', old.name, 'slug', old.slug));
    end if;
    return old;
  end if;
end;
$$;

comment on function public.audit_module_change() is
  'modules after trigger: writes module.created, module.updated (name or slug changed) and module.deleted audit events.';

revoke all on function public.audit_module_change() from public, anon, authenticated;

create trigger modules_audit
  after insert or update or delete on public.modules
  for each row execute function public.audit_module_change();

create or replace function public.audit_field_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, auth.uid(), 'field.created', 'field_definition', new.id::text,
            jsonb_build_object('module_id', new.module_id, 'key', new.key,
                               'type', new.type, 'label', new.label));
    return new;
  else
    -- Skip when the module (or the workspace) is being deleted: one
    -- module.deleted row stands for its fields.
    if exists (select 1 from public.modules m where m.id = old.module_id) then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.workspace_id, auth.uid(), 'field.deleted', 'field_definition', old.id::text,
              jsonb_build_object('module_id', old.module_id, 'key', old.key,
                                 'type', old.type, 'label', old.label));
    end if;
    return old;
  end if;
end;
$$;

comment on function public.audit_field_change() is
  'field_definitions after insert/delete trigger: writes field.created and field.deleted audit events (module_id, key, type, label).';

revoke all on function public.audit_field_change() from public, anon, authenticated;

create trigger field_definitions_audit
  after insert or delete on public.field_definitions
  for each row execute function public.audit_field_change();

-- ---------------------------------------------------------------------------
-- workspace_usage: single source for the usage page and Phase 4 entitlements
-- ---------------------------------------------------------------------------
create or replace function public.workspace_usage(p_workspace_id uuid)
returns table (modules integer, records integer, members integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      (select count(*)::integer from public.modules m where m.workspace_id = p_workspace_id),
      (select count(*)::integer from public.records r where r.workspace_id = p_workspace_id),
      (select count(*)::integer from public.workspace_members wm where wm.workspace_id = p_workspace_id);
end;
$$;

comment on function public.workspace_usage(uuid) is
  'Counts of modules, records and members of a workspace for auth.uid(), who must be a member (else 42501). Used by the usage page and the Phase 4 entitlement check.';

revoke all on function public.workspace_usage(uuid) from public, anon;
grant execute on function public.workspace_usage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.modules           enable row level security;
alter table public.field_definitions enable row level security;
alter table public.records           enable row level security;

revoke all on table public.modules, public.field_definitions, public.records
  from public, anon, authenticated;

-- Column-level insert and update grants: clients never supply created_at,
-- updated_at or search_vector, and never move a row to another workspace or
-- module (workspace_id and module_id are not updatable).
grant select, delete on table public.modules to authenticated;
grant insert (id, workspace_id, name, slug, description, icon, position, created_by)
  on table public.modules to authenticated;
grant update (name, slug, description, icon, position)
  on table public.modules to authenticated;

grant select, delete on table public.field_definitions to authenticated;
grant insert (id, workspace_id, module_id, key, label, type, required, position, options, settings)
  on table public.field_definitions to authenticated;
-- key is in the update grant so the trigger can answer with the clear 23514
-- message instead of a permission error.
grant update (key, label, type, required, position, options, settings)
  on table public.field_definitions to authenticated;

grant select, delete on table public.records to authenticated;
grant insert (id, workspace_id, module_id, title, status, custom_values, created_by)
  on table public.records to authenticated;
grant update (title, status, custom_values)
  on table public.records to authenticated;

-- modules: members read; owners and admins write ---------------------------
create policy modules_select_member
  on public.modules
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy modules_insert_owner_admin
  on public.modules
  for insert
  to authenticated
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and created_by = (select auth.uid())
  );

create policy modules_update_owner_admin
  on public.modules
  for update
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy modules_delete_owner_admin
  on public.modules
  for delete
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- field_definitions: members read; owners and admins write -----------------
create policy field_definitions_select_member
  on public.field_definitions
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy field_definitions_insert_owner_admin
  on public.field_definitions
  for insert
  to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy field_definitions_update_owner_admin
  on public.field_definitions
  for update
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy field_definitions_delete_owner_admin
  on public.field_definitions
  for delete
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- records: every member reads and writes (MVP rule) ------------------------
create policy records_select_member
  on public.records
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy records_insert_member
  on public.records
  for insert
  to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
  );

create policy records_update_member
  on public.records
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy records_delete_member
  on public.records
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));
