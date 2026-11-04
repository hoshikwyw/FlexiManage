import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { AttachmentRow } from '../types'
import { deleteAttachment } from './attachment-writes'
import { invalidateAttachments } from './invalidate'

/**
 * Deletes the attachment row (the server queues the storage object); refreshes
 * the list and `['usage', ws]`.
 */
export function useDeleteAttachment(workspaceId: string, recordId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (attachment: Pick<AttachmentRow, 'id'>) =>
      deleteAttachment(workspaceId, attachment),
    // Also after a failure, so a row deleted by someone else disappears from the list.
    onSettled: () => invalidateAttachments(queryClient, workspaceId, recordId),
  })
}
