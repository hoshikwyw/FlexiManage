import type { Attachment, Profile } from '@/types/database'

/** Columns the UI reads from `attachments` (explicit select list, see `ATTACHMENT_COLUMNS`). */
export type AttachmentRow = Pick<
  Attachment,
  | 'id'
  | 'workspace_id'
  | 'record_id'
  | 'file_name'
  | 'content_type'
  | 'size_bytes'
  | 'storage_path'
  | 'uploaded_by'
  | 'created_at'
>

export type UploaderProfile = Pick<Profile, 'id' | 'email' | 'full_name'>

/** An attachment with its uploader's profile (null when the user left or was deleted). */
export interface AttachmentItem extends AttachmentRow {
  uploader: UploaderProfile | null
}

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error'

/** Client-side progress of one file in an upload batch (not server state). */
export interface UploadProgress {
  /** Local id for React keys; not the attachment id. */
  id: string
  name: string
  sizeBytes: number
  status: UploadStatus
  error?: string
}
