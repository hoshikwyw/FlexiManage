import { useMutation, useQueryClient } from '@tanstack/react-query'

import { recordKeys } from '@/features/records/api/keys'
import { workspaceKeys } from '@/features/workspaces/api/keys'

import { moduleKeys } from './keys'
import { deleteModuleRow } from './module-writes'

/**
 * Deletes a module; its fields and records cascade and the trigger writes
 * `module.deleted`. The caller navigates to the modules list as soon as the
 * mutation resolves; the list is invalidated (not awaited) afterwards so the
 * module page never flashes "not found" for the module that was just removed.
 * Its records cache (`['records', ws, moduleId]`) is dropped and the per-module
 * counts are refreshed.
 */
export function useDeleteModule(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (moduleId: string): Promise<string> => {
      await deleteModuleRow(workspaceId, moduleId)
      return moduleId
    },
    onSuccess: (moduleId) => {
      queryClient.removeQueries({ queryKey: moduleKeys.detail(workspaceId, moduleId) })
      queryClient.removeQueries({ queryKey: moduleKeys.fields(workspaceId, moduleId) })
      queryClient.removeQueries({ queryKey: recordKeys.module(workspaceId, moduleId) })
      void queryClient.invalidateQueries({ queryKey: moduleKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: moduleKeys.usage(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: recordKeys.counts(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
