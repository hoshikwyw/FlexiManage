-- Migration 006: Phase 3 code and security review fixes (Part 17a, 2026-11-04)
--
-- Every change is a create or replace, a drop/re-add of a generated column, a
-- new constraint, trigger, function or grant on objects of migrations 004/005;
-- nothing earlier is edited. Contracts shared with the frontend (C1-C5) are
-- documented in docs/architecture.md, "Phase 3 review fixes".
--
--  1. Storage (C2, H1, L5):
--     * storage.objects select and delete policies for bucket `attachments`
--       are dropped (with their helpers): no client can list, download, sign
--       or remove objects. Downloads go through the Edge Function
--       `attachment-url` (C1); removal through the row delete and the queue.
--       Uploads do not need a select policy (storage-api inserts without
--       RETURNING and looks objects up as its superuser; verified with
--       supabase-js upload and TUS on storage-api 1.84.19).
--     * can_upload_attachment_object(): metadata and its mimetype are now
--       required, the row must still be pending (uploaded_at is null) and
--       younger than one hour.
--     * reconcile_attachment_object(): after insert/update on storage.objects
--       (bucket attachments) compares the stored object's size and MIME type
--       with the row. Signed upload URLs (`/object/upload/sign`, also the TUS
--       `/upload/resumable/sign` variant) write the object as the storage
--       superuser, bypassing RLS; this trigger is what catches them. A match
--       stamps attachments.uploaded_at; a mismatch (or an 11th uploaded file)
--       deletes the row (which queues the object) and writes
--       `attachment.rejected`; an object without a row is queued directly.
--     * attachments.uploaded_at; workspace_usage.storage_bytes and the
--       per-record cap ignore stale pending rows; sweep_stale_attachments()
--       removes rows still pending after one hour.
--  2. Records:
--     * update_record(p_record_id, p_expected_updated_at, p_patch) (C3):
--       optimistic concurrency, PT409 record_changed / PT404 not_found.
--     * record.deleted audit event (C5), not for module/workspace cascades.
--     * search_vector rebuilt over record_search_document() (C4): punctuated
--       values are indexed whole, split at `@`, and split into alphanumeric
--       parts. Title trigram index dropped; default sort index added.
--     * title must not be blank (Unicode whitespace aware).
--  3. Validation trigger (M3, L6, L7, concurrency): numbers |x| < 1e15 with at
--     most 6 fractional digits; whitespace-only counts as empty; objects and
--     arrays rejected before anything else; FOR SHARE on the module row; the
--     nested-trigger skip is a transaction-local flag set by
--     handle_field_deleted(). protect_field_definition() and
--     handle_field_deleted() lock the module row FOR UPDATE and ignore blank
--     values.
--  4. field_definitions: settings <= 2048 and options <= 32768 bytes (L4).
--  5. attachments.file_name: no `?`, `#` or `%` (code review 2).
--  6. Insert grants without `id` on modules, field_definitions, records (L3).
--  7. Scheduling: pg_cron + pg_net (when available). The service-role key is
--     read from Supabase Vault at run time; the purge job is created only when
--     the vault secrets `purge_attachments_service_key` and
--     `purge_attachments_url` exist (schedule_storage_maintenance()).
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

-- ---------------------------------------------------------------------------
-- Pure helper: blank text (JavaScript String.prototype.trim() whitespace)
-- ---------------------------------------------------------------------------
create or replace function public.text_is_blank(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value is null
    or p_value ~ '^[[:space:]   -     　﻿]*$';
$$;

comment on function public.text_is_blank(text) is
  'True for null, '''' and strings made only of whitespace (ASCII whitespace, NBSP, U+1680, U+2000-200A, U+2028/2029, U+202F, U+205F, U+3000, U+FEFF: the set JavaScript trim() removes). Used by checks and the validation trigger.';

-- ---------------------------------------------------------------------------
-- records.title: not blank (validated when the existing data allows it)
-- ---------------------------------------------------------------------------
alter table public.records
  add constraint records_title_not_blank_check check (not public.text_is_blank(title)) not valid;

do $$
begin
  if exists (select 1 from public.records r where public.text_is_blank(r.title)) then
    raise warning 'records_title_not_blank_check left NOT VALID: % record(s) have a blank title; fix them and run: alter table public.records validate constraint records_title_not_blank_check',
      (select count(*) from public.records r where public.text_is_blank(r.title));
  else
    alter table public.records validate constraint records_title_not_blank_check;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- field_definitions: size caps on settings and options (L4)
-- ---------------------------------------------------------------------------
alter table public.field_definitions
  add constraint field_definitions_settings_size_check check (pg_column_size(settings) <= 2048) not valid,
  add constraint field_definitions_options_size_check check (pg_column_size(options) <= 32768) not valid;

do $$
begin
  if exists (select 1 from public.field_definitions f where pg_column_size(f.settings) > 2048) then
    raise warning 'field_definitions_settings_size_check left NOT VALID: oversized settings exist';
  else
    alter table public.field_definitions validate constraint field_definitions_settings_size_check;
  end if;
  if exists (select 1 from public.field_definitions f where pg_column_size(f.options) > 32768) then
    raise warning 'field_definitions_options_size_check left NOT VALID: oversized options exist';
  else
    alter table public.field_definitions validate constraint field_definitions_options_size_check;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- attachments.file_name: no ? # % (they break object URLs; code review 2)
-- ---------------------------------------------------------------------------
alter table public.attachments
  add constraint attachments_file_name_url_safe_check check (file_name !~ '[?#%]') not valid;

do $$
begin
  if exists (select 1 from public.attachments a where a.file_name ~ '[?#%]') then
    raise warning 'attachments_file_name_url_safe_check left NOT VALID: % file name(s) contain ? # or %%',
      (select count(*) from public.attachments a where a.file_name ~ '[?#%]');
  else
    alter table public.attachments validate constraint attachments_file_name_url_safe_check;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- attachments.uploaded_at (L5)
-- ---------------------------------------------------------------------------
alter table public.attachments add column uploaded_at timestamptz;

comment on column public.attachments.uploaded_at is
  'Set by reconcile_attachment_object() when the object with the declared size and MIME type has been stored. Null = pending (row inserted, bytes not uploaded yet); pending rows older than one hour are removed by sweep_stale_attachments().';

-- Objects uploaded before this migration.
update public.attachments a
   set uploaded_at = o.created_at
  from storage.objects o
 where o.bucket_id = 'attachments'
   and o.name = a.storage_path
   and o.metadata ? 'size';

create index attachments_pending_created_idx
  on public.attachments (created_at)
  where uploaded_at is null;

-- ---------------------------------------------------------------------------
-- Search document (C4)
-- ---------------------------------------------------------------------------
-- The text of title, status and the string/number custom values is indexed
-- three times: as written (the parser keeps emails, hosts, decimals, signed
-- integers and hyphenated words whole), with `@` replaced by a space (the
-- domain of an email becomes a host lexeme: `example.com` finds
-- `ops@example.com`), and with every run of characters that are neither
-- letters/digits nor whitespace replaced by a space (`jane`, `acme`,
-- `example`; `12500`, `5`). Each copy keeps its own consecutive positions, so
-- the phrase operator to_tsquery() builds for a multi-part token (`foo-bar`,
-- `a_b`) still matches.
create or replace function public.record_search_document(p_title text, p_status text, p_values jsonb)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_tsvector('simple'::regconfig,
           t.base || ' ' || translate(t.base, '@', ' ') || ' '
           || regexp_replace(t.base, '[^[:alnum:][:space:]]+', ' ', 'g'))
  from (select coalesce(p_title, '') || ' ' || coalesce(p_status, '') || ' '
               || public.jsonb_values_text(p_values) as base) t;
$$;

comment on function public.record_search_document(text, text, jsonb) is
  'records.search_vector: to_tsvector(simple) of title, status and the string/number custom values, indexed whole, split at @, and split into alphanumeric parts (migration 006, contract C4).';

-- A generated column cannot be altered in place: drop and re-add it.
drop index public.records_search_vector_idx;
alter table public.records drop column search_vector;
alter table public.records
  add column search_vector tsvector generated always as (
    public.record_search_document(title, status, custom_values)
  ) stored;
create index records_search_vector_idx on public.records using gin (search_vector);

comment on column public.records.search_vector is
  'Generated: record_search_document(title, status, custom_values). Not writable; query with @@ to_tsquery(''simple'', ''tok:* & tok:*'') built by the C4 tokenizer.';

-- The ILIKE fallback only runs for search input without a single token
-- (punctuation only); it is scoped by workspace_id and module_id, so the
-- listing index narrows it. The trigram index cost a write on every record
-- change for that rare case.
drop index public.records_title_trgm_idx;

-- Default list order: updated_at desc, id.
create index records_workspace_module_updated_idx
  on public.records (workspace_id, module_id, updated_at desc, id);

-- ---------------------------------------------------------------------------
-- Custom value validation (M3, L6, L7, concurrency)
-- ---------------------------------------------------------------------------
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
  v_num    numeric;
begin
  -- The key strip of handle_field_deleted() is valid by construction and must
  -- not fail on a record that still lacks a later-added required field.
  if current_setting('app.field_strip', true) = 'on' then
    return new;
  end if;

  -- Serialise against concurrent field changes (protect_field_definition and
  -- handle_field_deleted lock the module row FOR UPDATE).
  perform 1 from public.modules m where m.id = new.module_id for share;

  if new.custom_values is null or jsonb_typeof(new.custom_values) <> 'object' then
    raise exception 'custom_values: expected object'
      using errcode = 'check_violation', column = 'custom_values';
  end if;

  -- One level only: no value may be an object or an array (checked before
  -- anything else looks at the values).
  select e.key into v_key
  from jsonb_each(new.custom_values) e
  where jsonb_typeof(e.value) in ('object', 'array')
  order by e.key
  limit 1;
  if v_key is not null then
    raise exception 'custom_values.%: nested objects and arrays are not allowed', v_key
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
       or (jsonb_typeof(v_value) = 'string' and public.text_is_blank(v_value #>> '{}')) then
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
        v_num := (v_value #>> '{}')::numeric;
        if abs(v_num) >= 1e15 or scale(trim_scale(v_num)) > 6 then
          raise exception 'custom_values.%: number out of range', v_field.key
            using errcode = 'check_violation', column = 'custom_values',
                  hint = 'Numbers must be smaller than 1e15 in absolute value with at most 6 decimals.';
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
  'records before insert/update trigger: custom_values must be a flat object whose keys are fields of the module; required fields present and not blank; values match the field type; numbers |x| < 1e15 with <= 6 decimals. Raises 23514 "custom_values.<key>: <reason>". Takes FOR SHARE on the module row; skipped while app.field_strip = on (handle_field_deleted).';

-- ---------------------------------------------------------------------------
-- Field definition guards: module lock, blank values are no values
-- ---------------------------------------------------------------------------
create or replace function public.protect_field_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used text;
begin
  -- Serialise against record writes validating against the old definition.
  perform 1 from public.modules m where m.id = old.module_id for update;

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
      and not (jsonb_typeof(r.custom_values -> old.key) = 'string'
               and public.text_is_blank(r.custom_values ->> old.key))
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
      and not public.text_is_blank(r.custom_values ->> old.key)
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
  'field_definitions before update trigger: key is immutable; type cannot change while records hold a non-blank value; a select option in use cannot be removed. Locks the module row FOR UPDATE first. Raises 23514.';

create or replace function public.handle_field_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Module (or workspace) cascade: the module row is already gone.
  perform 1 from public.modules m where m.id = old.module_id for update;
  if not found then
    return old;
  end if;

  perform set_config('app.field_strip', 'on', true);
  update public.records r
     set custom_values = r.custom_values - old.key
   where r.module_id = old.module_id
     and r.custom_values ? old.key;
  perform set_config('app.field_strip', 'off', true);

  return old;
end;
$$;

comment on function public.handle_field_deleted() is
  'field_definitions after delete trigger: removes the deleted key from custom_values of the module''s records (validation skipped through the transaction-local flag app.field_strip). Locks the module row FOR UPDATE.';

-- ---------------------------------------------------------------------------
-- record.deleted audit (C5)
-- ---------------------------------------------------------------------------
-- Before delete, because the attachments cascade (an RI trigger that fires
-- after the row delete) has removed the attachments by the time an after
-- trigger runs. A before-row trigger fires only for a row the statement is
-- about to delete (after RLS and the row lock, re-checked under concurrent
-- updates) and is rolled back with the statement on any later error, so the
-- row is written exactly when the record is deleted. Skipped when the module
-- or the workspace is gone (cascade: module.deleted stands for its records; a
-- workspace delete removes the audit log itself).
create or replace function public.audit_record_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.modules m where m.id = old.module_id)
     or not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;

  insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (old.workspace_id, auth.uid(), 'record.deleted', 'record', old.id::text,
          jsonb_build_object(
            'module_id', old.module_id,
            'title', old.title,
            'attachment_count',
              (select count(*)::integer from public.attachments a where a.record_id = old.id)));
  return old;
end;
$$;

comment on function public.audit_record_delete() is
  'records before delete trigger: writes record.deleted { module_id, title, attachment_count } with auth.uid() as actor; skipped during module and workspace cascades.';

revoke all on function public.audit_record_delete() from public, anon, authenticated;

create trigger records_audit_delete
  before delete on public.records
  for each row execute function public.audit_record_delete();

-- ---------------------------------------------------------------------------
-- update_record (C3): optimistic concurrency
-- ---------------------------------------------------------------------------
create or replace function public.update_record(
  p_record_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row   public.records;
  v_key   text;
  v_set   jsonb;
  v_unset text[];
begin
  if p_record_id is null or p_expected_updated_at is null then
    raise exception 'update_record: p_record_id and p_expected_updated_at are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch: expected object' using errcode = 'invalid_parameter_value';
  end if;

  select k into v_key
  from jsonb_object_keys(p_patch) k
  where k not in ('title', 'status', 'set', 'unset')
  order by k
  limit 1;
  if v_key is not null then
    raise exception 'p_patch.%: unknown key', v_key using errcode = 'invalid_parameter_value';
  end if;
  if p_patch ? 'title' and jsonb_typeof(p_patch -> 'title') <> 'string' then
    raise exception 'p_patch.title: expected string' using errcode = 'invalid_parameter_value';
  end if;
  if p_patch ? 'status' and jsonb_typeof(p_patch -> 'status') not in ('string', 'null') then
    raise exception 'p_patch.status: expected string or null' using errcode = 'invalid_parameter_value';
  end if;
  if p_patch ? 'set' and jsonb_typeof(p_patch -> 'set') <> 'object' then
    raise exception 'p_patch.set: expected object' using errcode = 'invalid_parameter_value';
  end if;
  if p_patch ? 'unset' and (
       jsonb_typeof(p_patch -> 'unset') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_patch -> 'unset') e where jsonb_typeof(e) <> 'string')
     ) then
    raise exception 'p_patch.unset: expected array of strings' using errcode = 'invalid_parameter_value';
  end if;

  if p_patch ? 'set' or p_patch ? 'unset' then
    v_set   := coalesce(p_patch -> 'set', '{}'::jsonb);
    v_unset := array(select jsonb_array_elements_text(coalesce(p_patch -> 'unset', '[]'::jsonb)));

    update public.records r
       set title         = coalesce(p_patch ->> 'title', r.title),
           status        = case when p_patch ? 'status' then p_patch ->> 'status' else r.status end,
           custom_values = (r.custom_values - v_unset) || v_set
     where r.id = p_record_id
       and r.updated_at = p_expected_updated_at
    returning r.* into v_row;
  else
    -- custom_values is not in the SET list, so the validation trigger does not
    -- fire: a title/status edit of a stale record still succeeds.
    update public.records r
       set title  = coalesce(p_patch ->> 'title', r.title),
           status = case when p_patch ? 'status' then p_patch ->> 'status' else r.status end
     where r.id = p_record_id
       and r.updated_at = p_expected_updated_at
    returning r.* into v_row;
  end if;

  if not found then
    if exists (select 1 from public.records r where r.id = p_record_id) then
      raise exception 'record_changed'
        using errcode = 'PT409',
              hint = 'The record was changed by someone else. Reload it and apply your change again.';
    end if;
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  return v_row;
end;
$$;

comment on function public.update_record(uuid, timestamptz, jsonb) is
  'Contract C3: updates title/status/custom_values (set, unset) of a record when updated_at still equals p_expected_updated_at. Security invoker (RLS applies). Raises PT409 record_changed (row visible, changed since), PT404 not_found (absent or not visible), 22023 for a malformed patch; validation errors stay 23514.';

revoke all on function public.update_record(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_record(uuid, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Insert grants without id (L3)
-- ---------------------------------------------------------------------------
revoke insert on table public.modules, public.field_definitions, public.records from authenticated;
grant insert (workspace_id, name, slug, description, icon, position, created_by)
  on table public.modules to authenticated;
grant insert (workspace_id, module_id, key, label, type, required, position, options, settings)
  on table public.field_definitions to authenticated;
grant insert (workspace_id, module_id, title, status, custom_values, created_by)
  on table public.records to authenticated;

-- ---------------------------------------------------------------------------
-- Attachments: cap, audit and usage ignore stale pending rows
-- ---------------------------------------------------------------------------
-- Uploaded rows and rows still in flight (pending, younger than one hour)
-- count toward the cap of 10; a stale pending row (failed upload whose
-- rollback also failed) does not block the slot. reconcile_attachment_object()
-- re-checks the cap when an object arrives, so in-flight rows cannot push a
-- record past 10 uploaded files.
create or replace function public.enforce_attachment_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('attachments:' || new.record_id::text));
  if (select count(*) from public.attachments a
      where a.record_id = new.record_id
        and (a.uploaded_at is not null or a.created_at > now() - interval '1 hour')) >= 10 then
    raise exception 'attachments: at most 10 files per record'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_attachment_cap() is
  'attachments before insert trigger: at most 10 uploaded or in-flight (pending < 1 hour) attachments per record (23514 "attachments: at most 10 files per record"). Per-record advisory lock.';

-- attachment.removed is not written for a reconciliation rejection
-- (attachment.rejected is) nor for cascades.
create or replace function public.audit_attachment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.workspace_id, auth.uid(), 'attachment.added', 'attachment', new.id::text,
            jsonb_build_object('record_id', new.record_id, 'file_name', new.file_name,
                               'size_bytes', new.size_bytes));
    return new;
  else
    if current_setting('app.attachment_reject', true) is distinct from 'on'
       and exists (select 1 from public.records r where r.id = old.record_id)
       and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.workspace_id, auth.uid(), 'attachment.removed', 'attachment', old.id::text,
              jsonb_build_object('record_id', old.record_id, 'file_name', old.file_name,
                                 'size_bytes', old.size_bytes));
    end if;
    return old;
  end if;
end;
$$;

comment on function public.audit_attachment_change() is
  'attachments after insert/delete trigger: attachment.added and attachment.removed with { record_id, file_name, size_bytes }. Not for cascades nor for reconciliation rejections (attachment.rejected).';

-- workspace_usage: storage_bytes counts uploaded rows only (same signature and
-- return type as migration 005, so create or replace).
create or replace function public.workspace_usage(p_workspace_id uuid)
returns table (
  modules        integer,
  records        integer,
  members        integer,
  attachments    integer,
  storage_bytes  bigint
)
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
      (select count(*)::integer from public.workspace_members wm where wm.workspace_id = p_workspace_id),
      (select count(*)::integer from public.attachments a where a.workspace_id = p_workspace_id),
      (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a
       where a.workspace_id = p_workspace_id and a.uploaded_at is not null);
end;
$$;

comment on function public.workspace_usage(uuid) is
  'Counts of modules, records, members and attachments rows, and storage_bytes (sum of size_bytes of uploaded attachments only, migration 006) of a workspace for auth.uid(), who must be a member (else 42501).';

-- ---------------------------------------------------------------------------
-- storage.objects: insert only (C2)
-- ---------------------------------------------------------------------------
drop policy attachments_objects_select_member on storage.objects;
drop policy attachments_objects_delete_uploader_or_owner_admin on storage.objects;
drop function public.can_read_attachment_object(text);
drop function public.can_delete_attachment_object(text);

-- storage-api calls the insert policy twice for a normal upload: before the
-- bytes are written (metadata { mimetype, contentLength } where contentLength
-- is the request size, not the file size) and after (metadata from the
-- backend with size and mimetype). Both must carry a mimetype equal to
-- content_type; when size is present it must equal size_bytes.
create or replace function public.can_upload_attachment_object(p_name text, p_metadata jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_metadata is not null
    and jsonb_typeof(p_metadata) = 'object'
    and exists (
      select 1
      from public.attachments a
      where a.storage_path = p_name
        and a.uploaded_by = auth.uid()
        and a.uploaded_at is null
        and a.created_at > now() - interval '1 hour'
        and public.is_workspace_member(a.workspace_id)
        and split_part(p_metadata ->> 'mimetype', ';', 1) = a.content_type
        and (p_metadata ->> 'size' is null
             or (p_metadata ->> 'size') = a.size_bytes::text)
    )
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'attachments'
        and o.name = p_name
    );
$$;

comment on function public.can_upload_attachment_object(text, jsonb) is
  'storage.objects insert policy for bucket attachments: metadata present; a pending (uploaded_at null, < 1 hour old) attachments row with storage_path = name inserted by auth.uid() (still a member); metadata mimetype equals content_type and size (when present) equals size_bytes; no object exists yet.';

-- ---------------------------------------------------------------------------
-- reconcile_attachment_object(): the server-side truth for every stored object
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_attachment_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att       public.attachments%rowtype;
  v_size      text := new.metadata ->> 'size';
  v_mime      text := split_part(new.metadata ->> 'mimetype', ';', 1);
  v_reason    text;
  v_ws_text   text := split_part(new.name, '/', 1);
begin
  -- Pre-upload permission checks carry no size yet; the policy handles them.
  if new.metadata is null or v_size is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.metadata is not distinct from new.metadata then
    return new;
  end if;

  select a.* into v_att
  from public.attachments a
  where a.storage_path = new.name
  for update;

  if not found then
    -- No row (deleted while the upload ran, or written by a superuser): queue
    -- the object so purge-attachments removes it.
    insert into public.storage_deletion_queue (bucket_id, object_name, workspace_id)
    values ('attachments', new.name,
            case when v_ws_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then v_ws_text::uuid
                 else '00000000-0000-0000-0000-000000000000'::uuid end);
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('attachments:' || v_att.record_id::text));

  if v_size <> v_att.size_bytes::text then
    v_reason := 'size_mismatch';
  elsif v_mime is distinct from v_att.content_type then
    v_reason := 'content_type_mismatch';
  elsif v_att.uploaded_at is null
        and (select count(*) from public.attachments a
             where a.record_id = v_att.record_id
               and a.uploaded_at is not null
               and a.id <> v_att.id) >= 10 then
    v_reason := 'too_many_files';
  end if;

  if v_reason is null then
    if v_att.uploaded_at is null then
      update public.attachments a set uploaded_at = now() where a.id = v_att.id;
    end if;
    return new;
  end if;

  -- Reject: delete the row (enqueue_attachment_object_deletion queues the
  -- object), log attachment.rejected instead of attachment.removed.
  perform set_config('app.attachment_reject', 'on', true);
  delete from public.attachments a where a.id = v_att.id;
  perform set_config('app.attachment_reject', 'off', true);

  insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_att.workspace_id, v_att.uploaded_by, 'attachment.rejected', 'attachment', v_att.id::text,
          jsonb_build_object(
            'record_id', v_att.record_id,
            'file_name', v_att.file_name,
            'size_bytes', v_att.size_bytes,
            'object_size_bytes', case when v_size ~ '^\d{1,18}$' then v_size::bigint end,
            'object_content_type', left(v_mime, 255),
            'reason', v_reason));
  return new;
end;
$$;

comment on function public.reconcile_attachment_object() is
  'storage.objects after insert/update trigger (bucket attachments): when the object metadata has a size, compares size and MIME type with the attachments row. Match: stamps uploaded_at. Mismatch or an 11th uploaded file: deletes the row (queues the object) and writes attachment.rejected { record_id, file_name, size_bytes, object_size_bytes, object_content_type, reason }. No row: queues the object.';

revoke all on function public.reconcile_attachment_object() from public, anon, authenticated;

create trigger attachments_reconcile_object
  after insert or update of metadata on storage.objects
  for each row
  when (new.bucket_id = 'attachments')
  execute function public.reconcile_attachment_object();

-- ---------------------------------------------------------------------------
-- Maintenance: stale pending rows, purge invocation, schedule
-- ---------------------------------------------------------------------------
create or replace function public.sweep_stale_attachments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.attachments a
   where a.uploaded_at is null
     and a.created_at < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.sweep_stale_attachments() is
  'Deletes attachments rows still pending (uploaded_at null) one hour after their insert; their (absent) objects are queued like any delete and the deletes are audited as attachment.removed with a null actor. Returns the count. service_role and pg_cron only.';

revoke all on function public.sweep_stale_attachments() from public, anon, authenticated;
grant execute on function public.sweep_stale_attachments() to service_role;

-- Calls purge-attachments through pg_net with the service-role key from Vault.
-- Returns the pg_net request id, or null when pg_net or a secret is missing.
create or replace function public.invoke_purge_attachments()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_url text;
  v_id  bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise warning 'invoke_purge_attachments: pg_net or supabase_vault is not installed';
    return null;
  end if;

  execute $sql$select decrypted_secret from vault.decrypted_secrets where name = 'purge_attachments_service_key'$sql$
    into v_key;
  execute $sql$select decrypted_secret from vault.decrypted_secrets where name = 'purge_attachments_url'$sql$
    into v_url;
  if v_key is null or v_url is null then
    raise warning 'invoke_purge_attachments: vault secrets purge_attachments_service_key and purge_attachments_url are required';
    return null;
  end if;

  execute $sql$
    select net.http_post(
      url := $1,
      body := '{"limit": 500}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || $2,
                                    'apikey', $2),
      timeout_milliseconds := 60000)
  $sql$ into v_id using v_url, v_key;
  return v_id;
end;
$$;

comment on function public.invoke_purge_attachments() is
  'pg_cron job body: POSTs {"limit": 500} to purge-attachments (URL from vault secret purge_attachments_url) with the service-role key from vault secret purge_attachments_service_key. The key never leaves the database. postgres only.';

revoke all on function public.invoke_purge_attachments() from public, anon, authenticated, service_role;

-- (Re)creates the cron jobs. Idempotent: run it again after creating or
-- rotating the vault secrets (docs/operations.md, "Scheduled maintenance").
create or replace function public.schedule_storage_maintenance()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_secrets boolean := false;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not installed: nothing scheduled';
  end if;

  execute $sql$select cron.schedule('sweep-stale-attachments', '5-59/10 * * * *', 'select public.sweep_stale_attachments()')$sql$;

  if exists (select 1 from pg_extension where extname = 'supabase_vault')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute $sql$select count(*) = 2 from vault.secrets
                 where name in ('purge_attachments_service_key', 'purge_attachments_url')$sql$
      into v_has_secrets;
  end if;

  if v_has_secrets then
    execute $sql$select cron.schedule('purge-attachments', '*/10 * * * *', 'select public.invoke_purge_attachments()')$sql$;
    return 'scheduled: sweep-stale-attachments, purge-attachments';
  end if;

  if exists (select 1 from cron.job where jobname = 'purge-attachments') then
    execute $sql$select cron.unschedule('purge-attachments')$sql$;
  end if;
  return 'scheduled: sweep-stale-attachments; purge-attachments skipped (vault secrets purge_attachments_service_key and purge_attachments_url missing)';
end;
$$;

comment on function public.schedule_storage_maintenance() is
  'Creates the pg_cron jobs sweep-stale-attachments (every 10 min at :05) and, when both vault secrets exist, purge-attachments (every 10 min). Idempotent. postgres only.';

revoke all on function public.schedule_storage_maintenance() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  raise notice '%', public.schedule_storage_maintenance();
end;
$$;
