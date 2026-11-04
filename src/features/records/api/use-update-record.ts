import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { RecordPatch } from '../lib/record-values'
import type { RecordItem } from '../types'
import { recordKeys } from './keys'
import { updateRecordRpc } from './update-record-rpc'

export interface UpdateRecordVariables {
  recordId: string
  /** `updated_at` of the snapshot taken when the edit form opened. */
  expectedUpdatedAt: string
  /** Only the changed fields (`buildRecordPatch`); never ids or timestamps. */
  patch: RecordPatch
}

/**
 * Saves an edit through `update_record` with optimistic concurrency: the
 * server refuses with `PT409` when the record changed after
 * `expectedUpdatedAt`, so one person's save never silently overwrites
 * another's. Refreshes the detail cache with the returned row and invalidates
 * the module's lists.
 */
export function useUpdateRecord(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      recordId,
      expectedUpdatedAt,
      patch,
    }: UpdateRecordVariables): Promise<RecordItem> =>
      updateRecordRpc({
        p_record_id: recordId,
        p_expected_updated_at: expectedUpdatedAt,
        p_patch: patch,
      }),
    onSuccess: (record) => {
      queryClient.setQueryData(recordKeys.detail(workspaceId, moduleId, record.id), record)
      void queryClient.invalidateQueries({ queryKey: recordKeys.lists(workspaceId, moduleId) })
    },
  })
}
