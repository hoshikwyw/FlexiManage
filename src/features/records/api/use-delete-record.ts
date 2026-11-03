import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { RecordNotFoundError } from '../lib/record-errors'
import { invalidateRecordTotals } from './invalidate'
import { recordKeys } from './keys'

/**
 * Deletes a record. RLS filters a hidden or already deleted row to zero rows
 * without an error, so the hook asks for the deleted id and throws
 * `RecordNotFoundError` when nothing came back. The detail query is removed
 * (not refetched) so the page can navigate away without flashing "not found".
 * Part 13 adds the attachment rows and storage objects to the same path.
 */
export function useDeleteRecord(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (recordId: string): Promise<string> => {
      const { data, error } = await supabase
        .from('records')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('module_id', moduleId)
        .eq('id', recordId)
        .select('id')
      if (error) throw error
      if (data.length === 0) throw new RecordNotFoundError()
      return recordId
    },
    onSuccess: (recordId) => {
      queryClient.removeQueries({ queryKey: recordKeys.detail(workspaceId, moduleId, recordId) })
      invalidateRecordTotals(queryClient, workspaceId, moduleId)
    },
  })
}
