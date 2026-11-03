import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { RecordPayload } from '../lib/record-values'
import type { RecordItem } from '../types'
import { invalidateRecordTotals } from './invalidate'
import { recordKeys } from './keys'
import { RECORD_COLUMNS } from './record-queries'

/**
 * Inserts a record (any member, RLS `records_insert_member`). The only
 * creation path, so Phase 4's `check_entitlement` can sit in front of it.
 * `validate_record_custom_values()` rejects bad values with 23514.
 */
export function useCreateRecord(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: RecordPayload): Promise<RecordItem> => {
      const { data, error } = await supabase
        .from('records')
        .insert({ workspace_id: workspaceId, module_id: moduleId, ...payload })
        .select(RECORD_COLUMNS)
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (record) => {
      queryClient.setQueryData(recordKeys.detail(workspaceId, moduleId, record.id), record)
      invalidateRecordTotals(queryClient, workspaceId, moduleId)
    },
  })
}
