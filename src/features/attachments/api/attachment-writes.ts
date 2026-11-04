import { triggerDownload } from '@/lib/download'
import { supabase } from '@/lib/supabase'
import type { AttachmentInsert } from '@/types/database'

import { validateFile } from '../lib/attachment-rules'
import {
  AttachmentError,
  DELETE_FORBIDDEN_MESSAGE,
  mapAttachmentRowError,
  mapStorageError,
} from '../lib/storage-errors'
import type { AttachmentRow } from '../types'
import { ATTACHMENT_COLUMNS, ATTACHMENTS_BUCKET } from './attachment-queries'

/** Lifetime of a download link, in seconds (B4 hypothesis: 60). */
export const SIGNED_URL_TTL_SECONDS = 60

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

/**
 * Downloads through a signed URL valid for 60 seconds. `{ download }` makes
 * Storage answer with `Content-Disposition: attachment; filename=<file_name>`,
 * so the browser saves the file under its original name and the app stays put.
 */
export async function downloadAttachment(
  attachment: Pick<AttachmentRow, 'storage_path' | 'file_name'>,
): Promise<void> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: attachment.file_name,
    })
  if (error) throw mapStorageError(error)
  triggerDownload(data.signedUrl, attachment.file_name)
}

/**
 * B4 delete order: the storage object first, then the row (the object is only
 * readable and removable while its row exists). `remove` answers `[]` without
 * an error when the policy hides the object or it was never uploaded, so the
 * row delete decides: zero rows back means forbidden or already gone. The row
 * delete also enqueues the path in `storage_deletion_queue` (a no-op for
 * `purge-attachments` when the object is already gone).
 */
export async function deleteAttachment(
  workspaceId: string,
  attachment: Pick<AttachmentRow, 'id' | 'storage_path'>,
): Promise<void> {
  const { error: removeError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachment.storage_path])
  if (removeError) throw mapStorageError(removeError)

  const { data, error } = await supabase
    .from('attachments')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', attachment.id)
    .select('id')
  if (error) throw mapAttachmentRowError(error)
  if (data.length === 0) throw new AttachmentError('forbidden', DELETE_FORBIDDEN_MESSAGE)
}
