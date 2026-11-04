-- Migration 005: attachments (Epic B, story B4)
--
-- Tables:    attachments (one row per file on a record), storage_deletion_queue
--            (system table: storage objects whose row is gone and that still
--            have to be removed through the Storage API)
-- Storage:   private bucket `attachments` (10 MB, MIME allow-list) and the
--            storage.objects policies for it
-- Functions: can_read_attachment_object, can_upload_attachment_object,
--            can_delete_attachment_object (security definer policy helpers for
--            storage.objects), attachment_content_type_is_allowed,
--            attachment_file_name_is_valid (pure, used by check constraints),
--            enforce_attachment_cap, audit_attachment_change,
--            enqueue_attachment_object_deletion (triggers), workspace_usage
--            (recreated with attachments and storage_bytes)
--
-- Upload protocol (B4, insert-before-upload): the client inserts the
-- attachments row first (RLS, cap, checks; Phase 4 attaches check_entitlement
-- here), reads back the generated storage_path and only then uploads the bytes
-- to `attachments/<storage_path>`. The storage insert policy admits an object
-- only when its name equals the storage_path of an existing row uploaded by the
-- caller, and only when the declared size and MIME type match. If the upload
-- fails the client deletes the row. The bucket configuration rejects files
-- over 10 MB and MIME types outside the allow-list a second time.
--
-- Cleanup: Postgres cannot call the Storage API, and storage.objects refuses
-- direct deletes (storage.protect_delete(), CLI 2.122 / storage-api 1.84) which
-- would also leave the bytes in the backing store. Every deleted attachments
-- row (direct delete, or cascade from a record, module or workspace delete)
-- therefore enqueues its object in storage_deletion_queue; the Edge Function
-- purge-attachments (service role only) removes queued objects through the
-- Storage API.
--
-- Forward-only. Do not edit after it has been applied; add a new migration.

-- ---------------------------------------------------------------------------
-- records: target of the attachments composite foreign key
-- ---------------------------------------------------------------------------
alter table public.records
  add constraint records_id_workspace_id_key unique (id, workspace_id);

-- ---------------------------------------------------------------------------
-- Pure helpers (immutable; referenced by check constraints)
-- ---------------------------------------------------------------------------
-- MIME allow-list (hypothesis, B4). Mirrored by storage.buckets.allowed_mime_types
-- below and by the frontend upload control (Part 14).
create or replace function public.attachment_content_type_is_allowed(p_content_type text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_content_type = any (array[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]);
$$;

comment on function public.attachment_content_type_is_allowed(text) is
  'attachments_content_type_check: png, jpeg, gif, webp, pdf, plain text, csv, docx, xlsx, pptx, zip. Same list as the attachments bucket.';

-- File name rules: 1..255 characters, no leading or trailing whitespace, and
-- only characters that Supabase Storage accepts in an object key (letters,
-- digits, space and ! - . _ * ' ( ) & $ @ = ; : + , ?). This excludes `/`, `\`,
-- control characters and non-ASCII letters, so a row can never exist whose
-- object cannot be uploaded. The client sanitises the user's file name (B4).
create or replace function public.attachment_file_name_is_valid(p_file_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_file_name is not null
    and char_length(p_file_name) between 1 and 255
    and p_file_name = btrim(p_file_name)
    and p_file_name ~ '^[A-Za-z0-9 !._*''()&$@=;:+,?-]+$';
$$;

comment on function public.attachment_file_name_is_valid(text) is
  'attachments_file_name_check: 1..255 chars, trimmed, only Storage-safe key characters (A-Z a-z 0-9 space ! - . _ * '' ( ) & $ @ = ; : + , ?); never / \ or control characters.';

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  record_id     uuid not null,
  file_name     text not null,
  content_type  text not null,
  size_bytes    bigint not null,
  -- Object name in the `attachments` bucket. Generated, so a client can never
  -- choose it (a supplied value fails with 428C9).
  storage_path  text not null generated always as (
                  workspace_id::text || '/' || record_id::text || '/' || id::text || '-' || file_name
                ) stored,
  uploaded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint attachments_record_workspace_fkey
    foreign key (record_id, workspace_id) references public.records (id, workspace_id) on delete cascade,
  constraint attachments_file_name_check
    check (public.attachment_file_name_is_valid(file_name)),
  constraint attachments_content_type_check
    check (public.attachment_content_type_is_allowed(content_type)),
  constraint attachments_size_bytes_check
    check (size_bytes between 1 and 10485760),
  constraint attachments_storage_path_key unique (storage_path)
);

create index attachments_record_created_idx on public.attachments (record_id, created_at);
create index attachments_workspace_id_idx on public.attachments (workspace_id);

comment on table public.attachments is
  'A file attached to a record. The row is inserted before the upload (B4); the object lives in the private attachments bucket at storage_path. Deleting the row enqueues the object in storage_deletion_queue.';
comment on column public.attachments.storage_path is
  'Generated: <workspace_id>/<record_id>/<id>-<file_name>. The storage.objects policies match the object name against it.';
comment on column public.attachments.size_bytes is
  'Declared size in bytes, 1..10485760 (10 MB, hypothesis). The upload policy requires the uploaded object to have exactly this size; Phase 4 meters storage_bytes from it.';
comment on column public.attachments.uploaded_by is
  'Defaults to auth.uid(); the insert policy requires it to equal the caller. Only this user may upload the object.';

-- ---------------------------------------------------------------------------
-- Per-record cap (hypothesis: 10 files per record, B4)
-- ---------------------------------------------------------------------------
-- The advisory lock serialises concurrent inserts on the same record, so two
-- parallel uploads cannot both pass the count at 9.
create or replace function public.enforce_attachment_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('attachments:' || new.record_id::text));
  if (select count(*) from public.attachments a where a.record_id = new.record_id) >= 10 then
    raise exception 'attachments: at most 10 files per record'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_attachment_cap() is
  'attachments before insert trigger: at most 10 attachments per record (23514 "attachments: at most 10 files per record"). Per-record advisory lock.';

revoke all on function public.enforce_attachment_cap() from public, anon, authenticated;

create trigger attachments_enforce_cap
  before insert on public.attachments
  for each row execute function public.enforce_attachment_cap();

-- ---------------------------------------------------------------------------
-- Audit: attachment.added / attachment.removed
-- ---------------------------------------------------------------------------
-- Metadata is { record_id, file_name, size_bytes }: no storage path, no
-- content type, no file content. A delete that is part of a record, module or
-- workspace cascade is not logged per file (the record row is already gone;
-- record deletes are not audited in the MVP, and a workspace cascade removes
-- the audit log itself).
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
    if exists (select 1 from public.records r where r.id = old.record_id) then
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
  'attachments after insert/delete trigger: writes attachment.added and attachment.removed with { record_id, file_name, size_bytes }. Cascaded deletes (record already gone) are not logged per file.';

revoke all on function public.audit_attachment_change() from public, anon, authenticated;

create trigger attachments_audit
  after insert or delete on public.attachments
  for each row execute function public.audit_attachment_change();

-- ---------------------------------------------------------------------------
-- storage_deletion_queue (system table, not tenant-readable)
-- ---------------------------------------------------------------------------
-- workspace_id deliberately has no foreign key: entries must survive the
-- workspace delete that produced them. Nothing but service_role can read or
-- write it; rows are removed by purge-attachments once the object is gone.
create table public.storage_deletion_queue (
  id            bigint generated always as identity primary key,
  bucket_id     text not null check (char_length(bucket_id) between 1 and 100),
  object_name   text not null check (char_length(object_name) between 1 and 1024),
  workspace_id  uuid not null,
  enqueued_at   timestamptz not null default now(),
  attempts      integer not null default 0 check (attempts >= 0),
  last_error    text check (last_error is null or char_length(last_error) <= 500),
  last_attempt_at timestamptz
);

create index storage_deletion_queue_enqueued_idx on public.storage_deletion_queue (enqueued_at, id);
create index storage_deletion_queue_workspace_id_idx on public.storage_deletion_queue (workspace_id);

comment on table public.storage_deletion_queue is
  'Storage objects to remove through the Storage API because their attachments row was deleted. Filled by enqueue_attachment_object_deletion(); drained by the purge-attachments Edge Function (service role). No client access.';
comment on column public.storage_deletion_queue.workspace_id is
  'Workspace the object belonged to (no FK: the workspace may already be deleted).';

create or replace function public.enqueue_attachment_object_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_deletion_queue (bucket_id, object_name, workspace_id)
  values ('attachments', old.storage_path, old.workspace_id);
  return old;
end;
$$;

comment on function public.enqueue_attachment_object_deletion() is
  'attachments after delete trigger: enqueues the storage object for purge-attachments, for direct and cascaded deletes alike.';

revoke all on function public.enqueue_attachment_object_deletion() from public, anon, authenticated;

create trigger attachments_enqueue_object_deletion
  after delete on public.attachments
  for each row execute function public.enqueue_attachment_object_deletion();

-- ---------------------------------------------------------------------------
-- Row Level Security: attachments, storage_deletion_queue
-- ---------------------------------------------------------------------------
alter table public.attachments            enable row level security;
alter table public.storage_deletion_queue enable row level security;

revoke all on table public.attachments, public.storage_deletion_queue
  from public, anon, authenticated;

-- Insert is a column-level grant: id, storage_path, uploaded_by and created_at
-- are never supplied by the client (uploaded_by defaults to auth.uid()).
-- No update grant and no update policy: an attachment is immutable.
grant select, delete on table public.attachments to authenticated;
grant insert (workspace_id, record_id, file_name, content_type, size_bytes)
  on table public.attachments to authenticated;

create policy attachments_select_member
  on public.attachments
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy attachments_insert_member
  on public.attachments
  for insert
  to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and uploaded_by = (select auth.uid())
  );

-- The uploader, or an owner/admin of the workspace.
create policy attachments_delete_uploader_or_owner_admin
  on public.attachments
  for delete
  to authenticated
  using (
    (uploaded_by = (select auth.uid()) and public.is_workspace_member(workspace_id))
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- storage_deletion_queue: RLS on, no policies, no grants for API roles.

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- storage.objects policy helpers
-- ---------------------------------------------------------------------------
-- storage-api (1.84, CLI 2.122) runs every object query as the caller's role
-- (`authenticated` with request.jwt.claims set), so auth.uid() is the caller
-- and RLS on storage.objects decides. The object name is the full path inside
-- the bucket: <workspace_id>/<record_id>/<attachment_id>-<file_name>, equal to
-- attachments.storage_path, which is generated from exactly those columns. An
-- equality match on storage_path therefore also proves that the first segment
-- is the row's workspace and the second its record (which the composite FK
-- ties to the same workspace). The `owner` column is not used: it is the
-- uploader, but authorization follows the attachments row.
--
-- Security definer so the helpers read attachments and storage.objects without
-- re-entering RLS and keep membership logic inside is_workspace_member /
-- has_workspace_role.

-- select (download, signed URL creation, list): a row exists and the caller is
-- a member of its workspace.
create or replace function public.can_read_attachment_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments a
    where a.storage_path = p_name
      and public.is_workspace_member(a.workspace_id)
  );
$$;

comment on function public.can_read_attachment_object(text) is
  'storage.objects select policy for bucket attachments: an attachments row with storage_path = name exists and auth.uid() is a member of its workspace.';

-- insert (upload): the row exists, the caller is its uploader and still a
-- member, no object exists under the name yet, and, once storage-api knows
-- them (the final insert carries metadata; the pre-upload check through
-- storage.can_insert_object() does not), the object's size and MIME type
-- equal the declared size_bytes and content_type.
create or replace function public.can_upload_attachment_object(p_name text, p_metadata jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments a
    where a.storage_path = p_name
      and a.uploaded_by = auth.uid()
      and public.is_workspace_member(a.workspace_id)
      and (p_metadata ->> 'size' is null
           or (p_metadata ->> 'size') = a.size_bytes::text)
      and (p_metadata ->> 'mimetype' is null
           or split_part(p_metadata ->> 'mimetype', ';', 1) = a.content_type)
  )
  and not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'attachments'
      and o.name = p_name
  );
$$;

comment on function public.can_upload_attachment_object(text, jsonb) is
  'storage.objects insert policy for bucket attachments: an attachments row with storage_path = name exists, was inserted by auth.uid() (still a member), no object exists yet, and the metadata size/mimetype (when present) match size_bytes/content_type.';

-- delete: the row still exists and the caller may delete the row (uploader or
-- owner/admin). Objects whose row is already gone are removed by
-- purge-attachments, not by clients: storage-api deletes with RETURNING, which
-- also needs the select policy, and making orphaned objects readable would let
-- members download a file that was just removed.
create or replace function public.can_delete_attachment_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments a
    where a.storage_path = p_name
      and (
        (a.uploaded_by = auth.uid() and public.is_workspace_member(a.workspace_id))
        or public.has_workspace_role(a.workspace_id, array['owner', 'admin']::public.workspace_role[])
      )
  );
$$;

comment on function public.can_delete_attachment_object(text) is
  'storage.objects delete policy for bucket attachments: the attachments row with storage_path = name exists and auth.uid() is its uploader (and a member) or an owner/admin of its workspace.';

revoke all on function public.can_read_attachment_object(text) from public, anon;
revoke all on function public.can_upload_attachment_object(text, jsonb) from public, anon;
revoke all on function public.can_delete_attachment_object(text) from public, anon;
grant execute on function public.can_read_attachment_object(text) to authenticated;
grant execute on function public.can_upload_attachment_object(text, jsonb) to authenticated;
grant execute on function public.can_delete_attachment_object(text) to authenticated;

-- ---------------------------------------------------------------------------
-- storage.objects policies (bucket attachments only; other buckets keep the
-- default: RLS on, no policy, denied). No update policy: objects are
-- immutable, so `upsert: true` uploads and moves/copies are refused.
-- ---------------------------------------------------------------------------
create policy attachments_objects_select_member
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'attachments' and public.can_read_attachment_object(name));

create policy attachments_objects_insert_uploader
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'attachments' and public.can_upload_attachment_object(name, metadata));

create policy attachments_objects_delete_uploader_or_owner_admin
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'attachments' and public.can_delete_attachment_object(name));

-- ---------------------------------------------------------------------------
-- workspace_usage: add attachments and storage_bytes
-- ---------------------------------------------------------------------------
-- A different return type needs drop + create. The argument list is unchanged,
-- so supabase.rpc('workspace_usage', { p_workspace_id }) keeps working and the
-- existing columns keep their names and types; the row gains two columns.
-- storage_bytes is the sum of the declared attachments.size_bytes (equal to
-- the stored size for every uploaded object, see can_upload_attachment_object).
drop function public.workspace_usage(uuid);

create function public.workspace_usage(p_workspace_id uuid)
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
      (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a where a.workspace_id = p_workspace_id);
end;
$$;

comment on function public.workspace_usage(uuid) is
  'Counts of modules, records, members, attachments and the sum of attachment sizes (storage_bytes) of a workspace for auth.uid(), who must be a member (else 42501). Used by the usage page and the Phase 4 entitlement check.';

revoke all on function public.workspace_usage(uuid) from public, anon;
grant execute on function public.workspace_usage(uuid) to authenticated;
