import { skipToken, useQuery } from '@tanstack/react-query'

import { fetchAttachments } from './attachment-queries'
import { attachmentKeys } from './keys'

/** Attachments of one record (`['attachments', workspaceId, recordId]`). */
export function useAttachments(
  workspaceId: string | null | undefined,
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: attachmentKeys.record(workspaceId ?? '', recordId ?? ''),
    queryFn: workspaceId && recordId ? () => fetchAttachments(workspaceId, recordId) : skipToken,
  })
}
