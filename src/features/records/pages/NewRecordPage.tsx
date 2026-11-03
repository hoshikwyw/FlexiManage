import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { moduleKeys } from '@/features/modules/api/keys'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { useCreateRecord } from '../api/use-create-record'
import { RecordForm } from '../components/RecordForm'
import { emptyRecordFormValues, toRecordPayload } from '../schemas/record'
import { RecordBreadcrumb, RecordPageShell, type RecordPageContext } from './RecordPageShell'

/** `/w/:workspaceId/modules/:moduleId/records/new`. */
export function NewRecordPage() {
  return <RecordPageShell>{(context) => <NewRecord {...context} />}</RecordPageShell>
}

function NewRecord({ workspaceId, module, fields }: RecordPageContext) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createRecord = useCreateRecord(workspaceId, module.id)
  const defaultValues = useMemo(() => emptyRecordFormValues(fields), [fields])
  const moduleHref = WORKSPACE_ROUTES.module(workspaceId, module.id)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <RecordBreadcrumb workspaceId={workspaceId} module={module} current="New record" />
        <h1 className="text-2xl font-semibold tracking-tight">New record</h1>
      </div>
      {fields.length === 0 ? (
        <div className="flex max-w-xl flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-sm">
          <p>
            {module.name} has no fields yet. An owner or admin must define its fields before records
            can be created.
          </p>
          <Link to={moduleHref} className={buttonVariants({ variant: 'outline' })}>
            Back to {module.name}
          </Link>
        </div>
      ) : (
        <RecordForm
          mode="create"
          fields={fields}
          defaultValues={defaultValues}
          pending={createRecord.isPending}
          onSubmit={async (values) => {
            const record = await createRecord.mutateAsync(toRecordPayload(values))
            toast.success(`Record "${record.title}" created`)
            void navigate(moduleHref)
          }}
          onCancel={() => void navigate(moduleHref)}
          onFieldsStale={() =>
            void queryClient.invalidateQueries({
              queryKey: moduleKeys.fields(workspaceId, module.id),
            })
          }
        />
      )}
    </div>
  )
}
