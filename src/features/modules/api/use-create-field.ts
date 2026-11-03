import { useMutation, useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/features/workspaces/api/keys'
import type { FieldDefinition } from '@/types/database'

import type { FieldPayload } from '../lib/field-payload'
import { moduleKeys } from './keys'
import { insertField } from './module-writes'

/**
 * Adds a field at the next position (`position` = current count, supplied by
 * the caller from the loaded list). The database writes `field.created`.
 */
export function useCreateField(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      position,
      ...payload
    }: FieldPayload & { position: number }): Promise<FieldDefinition> =>
      insertField(workspaceId, { moduleId, ...payload, position }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: moduleKeys.fields(workspaceId, moduleId) })
      void queryClient.invalidateQueries({ queryKey: moduleKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
