import { getDisplayName } from '@/features/profile/lib/display-name'

import type { AttachmentItem } from '../types'

/** "you" for the caller's own files, the uploader's name, or "Someone" when the profile is gone. */
export function uploaderName(
  attachment: Pick<AttachmentItem, 'uploaded_by' | 'uploader'>,
  currentUserId: string | null,
): string {
  if (attachment.uploaded_by && attachment.uploaded_by === currentUserId) return 'you'
  return attachment.uploader ? getDisplayName(attachment.uploader) : 'Someone'
}
