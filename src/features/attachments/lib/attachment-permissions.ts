import type { WorkspaceRole } from '@/types/database'

import type { AttachmentRow } from '../types'

/**
 * Mirror of `attachments_delete_uploader_or_owner_admin` and the storage
 * delete policy: the uploader, or an owner or admin. Hides the delete action
 * only; RLS and the storage policy decide.
 */
export function canDeleteAttachment(
  attachment: Pick<AttachmentRow, 'uploaded_by'>,
  userId: string | null | undefined,
  role: WorkspaceRole | null | undefined,
): boolean {
  if (role === 'owner' || role === 'admin') return true
  if (!role || !userId) return false
  return attachment.uploaded_by === userId
}
