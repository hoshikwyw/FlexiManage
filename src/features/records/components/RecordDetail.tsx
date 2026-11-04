import { PencilIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AttachmentsSection } from '@/features/attachments/components/AttachmentsSection'
import { formatFieldValue } from '@/features/records/fields/registry'
import { formatDateTime } from '@/lib/format'
import type { FieldDefinition, WorkspaceRole } from '@/types/database'

import { readCustomValues } from '../lib/record-values'
import { missingRequiredFields } from '../schemas/record'
import type { RecordItem } from '../types'

interface RecordDetailProps {
  record: RecordItem
  fields: readonly FieldDefinition[]
  editHref: string
  /** Display name of the creator ("you", a member name or "Someone"). */
  createdByName: string
  onDelete: () => void
  /** For the attachments section: who may delete which file (UI only). */
  currentUserId: string | null
  role: WorkspaceRole | null
}

/**
 * Read view of a record: every field in module order formatted by the
 * registry, the free-text status, created/updated meta, edit and delete
 * actions, and the attachments section (story B4). Required fields added
 * after the record was created are called out so the user fills them.
 */
export function RecordDetail({
  record,
  fields,
  editHref,
  createdByName,
  onDelete,
  currentUserId,
  role,
}: RecordDetailProps) {
  const values = readCustomValues(record.custom_values)
  const missing = missingRequiredFields(record, fields)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{record.title}</h1>
          <p className="text-muted-foreground text-sm">
            Created by {createdByName} on {formatDateTime(record.created_at)} · Updated{' '}
            {formatDateTime(record.updated_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={editHref} className={buttonVariants({ variant: 'outline' })}>
            <PencilIcon aria-hidden="true" />
            Edit
          </Link>
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2Icon aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {missing.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Required {missing.length === 1 ? 'field' : 'fields'} without a value:{' '}
            {missing.map((field) => field.label).join(', ')}. Edit the record to fill{' '}
            {missing.length === 1 ? 'it' : 'them'} before changing other values.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(8rem,auto)_1fr]">
            <dt className="text-muted-foreground text-sm">Record status</dt>
            <dd className="text-sm">{record.status || '—'}</dd>
            {fields.map((field) => (
              <div key={field.id} className="contents" data-field-key={field.key}>
                <dt className="text-muted-foreground text-sm">{field.label}</dt>
                <dd className="text-sm break-words">
                  {formatFieldValue(values[field.key], field) || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <AttachmentsSection
        workspaceId={record.workspace_id}
        recordId={record.id}
        currentUserId={currentUserId}
        role={role}
      />
    </div>
  )
}
