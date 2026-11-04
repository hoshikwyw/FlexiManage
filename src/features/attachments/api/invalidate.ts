import type { QueryClient } from '@tanstack/react-query'

import { moduleKeys } from '@/features/modules/api/keys'

import { attachmentKeys } from './keys'

/** After an upload or delete: the record's list and `['usage', ws]` (attachments, storage_bytes). */
export function invalidateAttachments(
  queryClient: QueryClient,
  workspaceId: string,
  recordId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: attachmentKeys.record(workspaceId, recordId) }),
    queryClient.invalidateQueries({ queryKey: moduleKeys.usage(workspaceId) }),
  ]).then(() => undefined)
}
