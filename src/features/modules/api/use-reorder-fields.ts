import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { FieldDefinition } from '@/types/database'

import { moduleKeys } from './keys'

/**
 * Returns the fields with `position` renumbered 0..n-1 after moving the field
 * at `from` to `to`; pure, so it can be tested and used for optimistic updates.
 */
export function moveField(
  fields: readonly FieldDefinition[],
  from: number,
  to: number,
): FieldDefinition[] {
  const next = [...fields]
  const [moved] = next.splice(from, 1)
  if (!moved) return [...fields]
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next.map((field, position) => ({ ...field, position }))
}

/** The fields of `ordered` whose position differs from the one they had in `previous`. */
export function changedPositions(
  previous: readonly FieldDefinition[],
  ordered: readonly FieldDefinition[],
): FieldDefinition[] {
  const before = new Map(previous.map((field) => [field.id, field.position]))
  return ordered.filter((field) => before.get(field.id) !== field.position)
}

export interface ReorderFieldsVariables {
  /** The list as it was before the move (the diff is computed against it). */
  previous: FieldDefinition[]
  /** The new order with positions renumbered (`moveField`). */
  ordered: FieldDefinition[]
}

/**
 * Persists a new order with one position update per field whose position
 * changed (PostgREST has no batch update; fields are capped at 50 per module).
 * The list is updated optimistically in `onMutate` and refetched afterwards;
 * the diff is taken against `previous` because by the time `mutationFn` runs
 * the cache already holds the new order.
 */
export function useReorderFields(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()
  const key = moduleKeys.fields(workspaceId, moduleId)

  return useMutation({
    mutationFn: async ({
      previous,
      ordered,
    }: ReorderFieldsVariables): Promise<FieldDefinition[]> => {
      const results = await Promise.all(
        changedPositions(previous, ordered).map((field) =>
          supabase
            .from('field_definitions')
            .update({ position: field.position })
            .eq('workspace_id', workspaceId)
            .eq('id', field.id)
            .select('id'),
        ),
      )
      const failed = results.find((result) => result.error)
      if (failed?.error) throw failed.error
      return ordered
    },
    onMutate: async ({ ordered }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const snapshot = queryClient.getQueryData<FieldDefinition[]>(key)
      queryClient.setQueryData(key, ordered)
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) queryClient.setQueryData(key, context.snapshot)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
