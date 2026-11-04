import { useMutation, useQueryClient } from '@tanstack/react-query'

import { attachmentKeys } from '@/features/attachments/api/keys'
import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'

import { RecordNotFoundError } from '../lib/record-errors'
import { invalidateRecordTotals } from './invalidate'
import { recordKeys } from './keys'

/**
 * Deletes a record. RLS filters a hidden or already deleted row to zero rows
 * without an error, so the hook asks for the deleted id and throws
 * `RecordNotFoundError` when nothing came back. The detail query is removed
 * (not refetched) so the page can navigate away without flashing "not found".
 * Attachments go with it: their rows cascade (composite FK) and the
 * `enqueue_attachment_object_deletion` trigger queues every storage object for
 * `purge-attachments`; the client does not remove objects here, because a
 * member may delete a record holding files they could not remove themselves.
 * The record's attachments cache is dropped; the server writes a
 * `record.deleted` audit row (`{ module_id, title, attachment_count }`).
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
      queryClient.removeQueries({ queryKey: attachmentKeys.record(workspaceId, recordId) })
      invalidateRecordTotals(queryClient, workspaceId, moduleId)
      // The server audits `record.deleted`; refresh the activity feed.
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
