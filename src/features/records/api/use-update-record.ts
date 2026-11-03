import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { RecordPayload } from '../lib/record-values'
import type { RecordItem } from '../types'
import { recordKeys } from './keys'
import { RECORD_COLUMNS } from './record-queries'

export interface UpdateRecordVariables {
  recordId: string
  /** Only the changed columns (`diffRecordPayload`); never ids or timestamps. */
  changes: Partial<RecordPayload>
}

/**
 * Updates title, status and/or custom_values and nothing else. `.single()`
 * turns a zero-row update (record deleted meanwhile) into `PGRST116`.
 * Refreshes the detail cache and invalidates the module's lists.
 */
export function useUpdateRecord(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ recordId, changes }: UpdateRecordVariables): Promise<RecordItem> => {
      const update: Partial<RecordPayload> = {}
      if (changes.title !== undefined) update.title = changes.title
      if (changes.status !== undefined) update.status = changes.status
      if (changes.custom_values !== undefined) update.custom_values = changes.custom_values
      const { data, error } = await supabase
        .from('records')
        .update(update)
        .eq('workspace_id', workspaceId)
        .eq('module_id', moduleId)
        .eq('id', recordId)
        .select(RECORD_COLUMNS)
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (record) => {
      queryClient.setQueryData(recordKeys.detail(workspaceId, moduleId, record.id), record)
      void queryClient.invalidateQueries({ queryKey: recordKeys.lists(workspaceId, moduleId) })
    },
  })
}
