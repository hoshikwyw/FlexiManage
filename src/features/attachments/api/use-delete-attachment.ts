import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { AttachmentRow } from '../types'
import { deleteAttachment } from './attachment-writes'
import { invalidateAttachments } from './invalidate'

/** Removes the storage object, then the row; refreshes the list and `['usage', ws]`. */
export function useDeleteAttachment(workspaceId: string, recordId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (attachment: Pick<AttachmentRow, 'id' | 'storage_path'>) =>
      deleteAttachment(workspaceId, attachment),
    // Also after a failure: a half-done delete (object gone, row kept) must show up.
    onSettled: () => invalidateAttachments(queryClient, workspaceId, recordId),
  })
}
