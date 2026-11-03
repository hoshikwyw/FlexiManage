import { useMutation, useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/features/workspaces/api/keys'

import { moduleKeys } from './keys'
import { deleteFieldRow } from './module-writes'

/**
 * Deletes a field definition. `handle_field_deleted()` removes its key from the
 * module's records, so the records cache is stale afterwards (Part 12
 * invalidates `['records', workspaceId, moduleId]` here).
 */
export function useDeleteField(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (fieldId: string): Promise<string> => {
      await deleteFieldRow(workspaceId, fieldId)
      return fieldId
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: moduleKeys.fields(workspaceId, moduleId) })
      void queryClient.invalidateQueries({ queryKey: moduleKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: ['records', workspaceId, moduleId] })
    },
  })
}
