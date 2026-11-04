import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { RecordItem } from '../types'
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

/**
 * Fetches the latest version of a record now (ignoring freshness) and writes
 * it to the detail cache; resolves to null when the record is gone. Used by
 * the edit form's "Reload" after a conflict.
 */
export function useRefreshRecord(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()
  return useCallback(
    (recordId: string): Promise<RecordItem | null> =>
      queryClient.fetchQuery({
        queryKey: recordKeys.detail(workspaceId, moduleId, recordId),
        queryFn: () => fetchRecord(workspaceId, moduleId, recordId),
        staleTime: 0,
      }),
    [moduleId, queryClient, workspaceId],
  )
}
