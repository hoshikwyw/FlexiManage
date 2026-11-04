import { triggerDownload } from '@/lib/download'
import { readFunctionError } from '@/lib/function-errors'
import { supabase } from '@/lib/supabase'
import type { AttachmentInsert } from '@/types/database'

import { validateFile } from '../lib/attachment-rules'
import {
  AttachmentError,
  DELETE_FORBIDDEN_MESSAGE,
  mapAttachmentFunctionError,
  mapAttachmentRowError,
  mapStorageError,
} from '../lib/storage-errors'
import type { AttachmentRow } from '../types'
import { ATTACHMENT_COLUMNS, ATTACHMENTS_BUCKET } from './attachment-queries'

export interface UploadAttachmentInput {
  workspaceId: string
  recordId: string
  file: File
  /** Attachments the record already has, including earlier files of the same batch. */
  existingCount: number
}

/**
 * Story B4 upload, insert-before-upload (docs/architecture.md, "Attachments"):
 *
 * 1. validate locally (size, type, cap) and sanitise the name;
 * 2. insert the `attachments` row and read back the generated `storage_path`
 *    (if this fails nothing is uploaded; Phase 4's `check_entitlement` sits here);
 * 3. upload the bytes to `attachments/<storage_path>` with `upsert: false`;
 * 4. if the upload fails, delete the row again (best effort) and rethrow.
 *
 * The storage insert policy requires the object's MIME type to equal the
 * row's `content_type`. storage-js sends a `File` as multipart form data whose
 * part type is `File.type` (the `contentType` option is ignored for Blobs), so
 * when the browser's type differs from the resolved one (`.csv` reported as
 * `application/vnd.ms-excel` on Windows, or an empty type) the bytes are
 * re-wrapped in a Blob of the resolved type.
 */
export async function uploadAttachment({
  workspaceId,
  recordId,
  file,
  existingCount,
}: UploadAttachmentInput): Promise<AttachmentRow> {
  const checked = validateFile(file, existingCount)
  if (!checked.ok) throw new AttachmentError(checked.error)
  const { fileName, contentType, sizeBytes } = checked.value

  const insert: AttachmentInsert = {
    workspace_id: workspaceId,
    record_id: recordId,
    file_name: fileName,
    content_type: contentType,
    size_bytes: sizeBytes,
  }
  const { data: row, error: insertError } = await supabase
    .from('attachments')
    .insert(insert)
    .select(ATTACHMENT_COLUMNS)
    .single()
  if (insertError) throw mapAttachmentRowError(insertError)

  const body = file.type === contentType ? file : new Blob([file], { type: contentType })
  let uploadError: unknown
  try {
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(row.storage_path, body, { contentType, upsert: false })
    uploadError = error
  } catch (error) {
    uploadError = error
  }
  if (uploadError) {
    await rollbackRow(workspaceId, row.id)
    throw mapStorageError(uploadError)
  }
  return row
}

/** Removes the row of a failed upload. If this fails too, a row without an object remains (Phase 5 sweep). */
async function rollbackRow(workspaceId: string, attachmentId: string): Promise<void> {
  try {
    await supabase
      .from('attachments')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', attachmentId)
  } catch {
    // Best effort; the original upload error is what the user needs to see.
  }
}

/** Answer of `attachment-url`: a short-lived download link and when it expires (ISO). */
export interface AttachmentUrlResult {
  url: string
  expiresAt: string
}

/**
 * Downloads through the `attachment-url` Edge Function, which checks
 * membership, signs a short-lived URL that answers with
 * `Content-Disposition: attachment` and returns `{ data: { url, expiresAt } }`.
 * The browser never signs storage URLs itself; a temporary anchor to `url`
 * starts the download without navigating the app.
 */
export async function downloadAttachment(
  attachment: Pick<AttachmentRow, 'id' | 'file_name'>,
): Promise<AttachmentUrlResult> {
  const { data, error } = await supabase.functions.invoke<{ data?: AttachmentUrlResult }>(
    'attachment-url',
    { body: { attachmentId: attachment.id } },
  )
  if (error) throw mapAttachmentFunctionError(await readFunctionError(error))
  const result = data?.data
  if (!result || typeof result.url !== 'string' || result.url === '') {
    throw new AttachmentError('unknown')
  }
  triggerDownload(result.url, attachment.file_name)
  return result
}

/**
 * Deletes the attachment row only. The `enqueue_attachment_object_deletion`
 * trigger queues the storage object for `purge-attachments`; the client never
 * removes objects. RLS filters a delete the caller may not make (not the
 * uploader, not an owner or admin) or a row already gone to zero rows without
 * an error, so the deleted id is selected and zero rows means forbidden.
 */
export async function deleteAttachment(
  workspaceId: string,
  attachment: Pick<AttachmentRow, 'id'>,
): Promise<void> {
  const { data, error } = await supabase
    .from('attachments')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', attachment.id)
    .select('id')
  if (error) throw mapAttachmentRowError(error)
  if (data.length === 0) throw new AttachmentError('forbidden', DELETE_FORBIDDEN_MESSAGE)
}
