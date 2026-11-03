import type { QueryClient } from '@tanstack/react-query'

import { moduleKeys } from '@/features/modules/api/keys'

import { recordKeys } from './keys'

/** After a create or delete: the module's lists, the per-module counts and `['usage', ws]`. */
export function invalidateRecordTotals(
  queryClient: QueryClient,
  workspaceId: string,
  moduleId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: recordKeys.lists(workspaceId, moduleId) })
  void queryClient.invalidateQueries({ queryKey: recordKeys.counts(workspaceId) })
  void queryClient.invalidateQueries({ queryKey: moduleKeys.usage(workspaceId) })
}
