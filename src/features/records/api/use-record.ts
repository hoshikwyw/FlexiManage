import { skipToken, useQuery } from '@tanstack/react-query'

import { recordKeys } from './keys'
import { fetchRecord } from './record-queries'

/** One record; `data === null` means not found (or another workspace's or module's record). */
export function useRecord(
  workspaceId: string | null | undefined,
  moduleId: string | null | undefined,
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: recordKeys.detail(workspaceId ?? '', moduleId ?? '', recordId ?? ''),
    queryFn:
      workspaceId && moduleId && recordId
        ? () => fetchRecord(workspaceId, moduleId, recordId)
        : skipToken,
  })
}
