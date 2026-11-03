import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query'

import type { RecordsQuery } from '../types'
import { recordKeys } from './keys'
import { fetchRecords } from './record-queries'

/**
 * One page of a module's records with search, filters and sort applied
 * server-side (`['records', ws, moduleId, 'list', query]`). The previous page
 * stays on screen while the next one loads. Pass `query = null` to wait (for
 * example until the field definitions are known).
 */
export function useRecords(
  workspaceId: string | null | undefined,
  moduleId: string | null | undefined,
  query: RecordsQuery | null,
) {
  return useQuery({
    queryKey: recordKeys.list(workspaceId ?? '', moduleId ?? '', query),
    queryFn:
      workspaceId && moduleId && query
        ? () => fetchRecords(workspaceId, moduleId, query)
        : skipToken,
    placeholderData: keepPreviousData,
  })
}
