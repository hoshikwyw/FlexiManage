import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import { moduleKeys } from '@/features/modules/api/keys'
import { fetchModules } from '@/features/modules/api/use-modules'

import { recordKeys } from './keys'
import { fetchRecordCounts } from './record-queries'

/**
 * `{ [moduleId]: count }` for every module of the workspace
 * (`['records', ws, 'counts']`). The module ids come from the modules list
 * cache (fetched if missing); the counts are parallel head-only queries.
 */
export function useRecordCounts(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: recordKeys.counts(workspaceId ?? ''),
    queryFn: workspaceId
      ? async () => {
          const modules = await queryClient.ensureQueryData({
            queryKey: moduleKeys.list(workspaceId),
            queryFn: () => fetchModules(workspaceId),
          })
          return fetchRecordCounts(
            workspaceId,
            modules.map((module) => module.id),
          )
        }
      : skipToken,
  })
}
