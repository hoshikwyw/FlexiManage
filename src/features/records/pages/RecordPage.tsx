import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { useSession } from '@/features/auth/api/use-session'
import { useMembers } from '@/features/members/api/use-members'
import { moduleKeys } from '@/features/modules/api/keys'
import { getDisplayName } from '@/features/profile/lib/display-name'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { useRecord } from '../api/use-record'
import { useUpdateRecord } from '../api/use-update-record'
import { DeleteRecordDialog } from '../components/DeleteRecordDialog'
import { RecordDetail } from '../components/RecordDetail'
import { RecordForm } from '../components/RecordForm'
import { diffRecordPayload } from '../lib/record-values'
import { recordToFormValues, toRecordPayload } from '../schemas/record'
import type { RecordItem } from '../types'
import {
  LoadError,
  PageSkeleton,
  RecordBreadcrumb,
  RecordPageShell,
  type RecordPageContext,
} from './RecordPageShell'

/** `/w/:workspaceId/modules/:moduleId/records/:recordId` (read mode; `?edit=1` edits). */
export function RecordPage() {
  return <RecordPageShell>{(context) => <RecordView {...context} />}</RecordPageShell>
}

/** Generic 404: the id does not exist, or belongs to another module or workspace. */
export function RecordNotFound({ moduleHref }: { moduleHref: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Record not found</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        This record does not exist in this module or was deleted.
      </p>
      <Link to={moduleHref} className={buttonVariants()}>
        Back to records
      </Link>
    </div>
  )
}

function RecordView({ workspaceId, module, fields }: RecordPageContext) {
  const { recordId } = useParams<{ recordId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const record = useRecord(workspaceId, module.id, recordId)
  const moduleHref = WORKSPACE_ROUTES.module(workspaceId, module.id)

  if (record.isPending) return <PageSkeleton label="Loading record" />
  if (record.isError) return <LoadError what="The record" onRetry={() => void record.refetch()} />
  if (!record.data) return <RecordNotFound moduleHref={moduleHref} />

  const editing = searchParams.get('edit') === '1'
  const recordHref = WORKSPACE_ROUTES.record(workspaceId, module.id, record.data.id)

  return (
    <div className="flex flex-col gap-4">
      <RecordBreadcrumb
        workspaceId={workspaceId}
        module={module}
        current={editing ? `Edit ${record.data.title}` : record.data.title}
      />
      {editing ? (
        <EditRecord
          key={record.data.id}
          workspaceId={workspaceId}
          module={module}
          fields={fields}
          record={record.data}
          onDone={() => void navigate(recordHref, { replace: true })}
        />
      ) : (
        <ReadRecord
          workspaceId={workspaceId}
          module={module}
          fields={fields}
          record={record.data}
          editHref={WORKSPACE_ROUTES.editRecord(workspaceId, module.id, record.data.id)}
          onDeleted={() => void navigate(moduleHref)}
        />
      )}
    </div>
  )
}

function ReadRecord({
  workspaceId,
  module,
  fields,
  record,
  editHref,
  onDeleted,
}: RecordPageContext & { record: RecordItem; editHref: string; onDeleted: () => void }) {
  const { user } = useSession()
  const { role } = useCurrentWorkspace()
  const members = useMembers(workspaceId)
  const [deleting, setDeleting] = useState(false)
  const creator = members.data?.find((member) => member.user_id === record.created_by)
  const createdByName =
    record.created_by && record.created_by === user?.id
      ? 'you'
      : creator
        ? getDisplayName(creator.profile, creator.profile?.email)
        : 'Someone'

  return (
    <>
      <RecordDetail
        record={record}
        fields={fields}
        editHref={editHref}
        createdByName={createdByName}
        onDelete={() => setDeleting(true)}
        currentUserId={user?.id ?? null}
        role={role}
      />
      <DeleteRecordDialog
        workspaceId={workspaceId}
        moduleId={module.id}
        record={deleting ? record : null}
        onClose={() => setDeleting(false)}
        onDeleted={onDeleted}
      />
    </>
  )
}

function EditRecord({
  workspaceId,
  module,
  fields,
  record,
  onDone,
}: RecordPageContext & { record: RecordItem; onDone: () => void }) {
  const queryClient = useQueryClient()
  const updateRecord = useUpdateRecord(workspaceId, module.id)
  const defaultValues = useMemo(() => recordToFormValues(record, fields), [record, fields])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {record.title}</h1>
      <RecordForm
        mode="edit"
        fields={fields}
        defaultValues={defaultValues}
        pending={updateRecord.isPending}
        onSubmit={async (values) => {
          const changes = diffRecordPayload(record, toRecordPayload(values))
          if (Object.keys(changes).length > 0) {
            await updateRecord.mutateAsync({ recordId: record.id, changes })
            toast.success('Record saved')
          }
          onDone()
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
