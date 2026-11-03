import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { FieldDefinition } from '@/types/database'

import { useFieldDefinitions } from '../api/use-field-definitions'
import { moveField, useReorderFields } from '../api/use-reorder-fields'
import { getModuleErrorMessage } from '../lib/module-errors'
import { DeleteFieldDialog } from './DeleteFieldDialog'
import { FieldDialog } from './FieldDialog'
import { FieldList, FieldListSkeleton } from './FieldList'

interface FieldsTabProps {
  workspaceId: string
  moduleId: string
  canManage: boolean
}

type DialogState =
  { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; field: FieldDefinition }

/** The Fields tab: list with add, edit, reorder and delete for owners and admins; read-only for members. */
export function FieldsTab({ workspaceId, moduleId, canManage }: FieldsTabProps) {
  const fields = useFieldDefinitions(workspaceId, moduleId)
  const reorder = useReorderFields(workspaceId, moduleId)
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' })
  const [deleting, setDeleting] = useState<FieldDefinition | null>(null)

  async function handleMove(from: number, to: number) {
    if (!fields.data) return
    try {
      await reorder.mutateAsync({
        previous: fields.data,
        ordered: moveField(fields.data, from, to),
      })
    } catch (error) {
      toast.error(getModuleErrorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {canManage
            ? 'Fields define what each record stores. Their order is used by forms, tables and exports.'
            : 'Fields define what each record stores. Only owners and admins can change them.'}
        </p>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setDialog({ kind: 'create' })}>
            <PlusIcon aria-hidden="true" />
            Add field
          </Button>
        ) : null}
      </div>

      {fields.isPending ? (
        <FieldListSkeleton />
      ) : fields.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm">
          <p className="text-destructive">Fields could not be loaded.</p>
          <Button type="button" variant="outline" onClick={() => void fields.refetch()}>
            Try again
          </Button>
        </div>
      ) : fields.data.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {canManage
            ? 'No fields yet. Add the first one to start recording data.'
            : 'No fields yet. An owner or admin must define fields before records can be created.'}
        </p>
      ) : (
        <FieldList
          fields={fields.data}
          canManage={canManage}
          busy={reorder.isPending}
          onEdit={(field) => setDialog({ kind: 'edit', field })}
          onDelete={setDeleting}
          onMove={(from, to) => void handleMove(from, to)}
        />
      )}

      {canManage ? (
        <>
          <FieldDialog
            workspaceId={workspaceId}
            moduleId={moduleId}
            open={dialog.kind !== 'closed'}
            onOpenChange={(open) => (open ? undefined : setDialog({ kind: 'closed' }))}
            field={dialog.kind === 'edit' ? dialog.field : undefined}
            nextPosition={fields.data?.length ?? 0}
          />
          <DeleteFieldDialog
            workspaceId={workspaceId}
            moduleId={moduleId}
            field={deleting}
            onClose={() => setDeleting(null)}
          />
        </>
      ) : null}
    </div>
  )
}
