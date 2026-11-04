import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { moduleKeys } from '@/features/modules/api/keys'

import { useRefreshRecord } from '../api/use-record'
import { useUpdateRecord } from '../api/use-update-record'
import { RecordForm } from '../components/RecordForm'
import { buildRecordPatch, isEmptyPatch } from '../lib/record-values'
import { recordToFormValues } from '../schemas/record'
import type { RecordItem } from '../types'
import type { RecordPageContext } from './RecordPageShell'

/**
 * The edit form. `snapshot` is the record as it was when the form opened (not
 * the latest cache, which a background refetch may change): the patch is the
 * diff against it and its `updated_at` is the expected version. After a
 * conflict, "Reload" fetches the latest version and makes it the snapshot.
 */
export function EditRecord({
  workspaceId,
  module,
  fields,
  record,
  onDone,
}: RecordPageContext & { record: RecordItem; onDone: () => void }) {
  const queryClient = useQueryClient()
  const updateRecord = useUpdateRecord(workspaceId, module.id)
  const refreshRecord = useRefreshRecord(workspaceId, module.id)
  const [snapshot, setSnapshot] = useState(record)
  const [defaultValues] = useState(() => recordToFormValues(record, fields))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {record.title}</h1>
      <RecordForm
        mode="edit"
        fields={fields}
        defaultValues={defaultValues}
        pending={updateRecord.isPending}
        onSubmit={async (values) => {
          const patch = buildRecordPatch(recordToFormValues(snapshot, fields), values)
          if (!isEmptyPatch(patch)) {
            await updateRecord.mutateAsync({
              recordId: snapshot.id,
              expectedUpdatedAt: snapshot.updated_at,
              patch,
            })
            toast.success('Record saved')
          }
          onDone()
        }}
        onReloadLatest={async () => {
          const latest = await refreshRecord(snapshot.id)
          if (!latest) return null
          setSnapshot(latest)
          return recordToFormValues(latest, fields)
        }}
        onCancel={onDone}
        onFieldsStale={() =>
          void queryClient.invalidateQueries({
            queryKey: moduleKeys.fields(workspaceId, module.id),
          })
        }
      />
    </div>
  )
}
