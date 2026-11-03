import { ArrowDownIcon, ArrowUpIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { FieldDefinition } from '@/types/database'

import { summariseField } from '../lib/field-summary'
import { FieldTypeBadge } from './FieldTypeBadge'

interface FieldListProps {
  fields: FieldDefinition[]
  /** Owner/admin: show edit, move and delete actions. */
  canManage: boolean
  /** Disables the actions while a mutation runs. */
  busy?: boolean
  onEdit?: (field: FieldDefinition) => void
  onDelete?: (field: FieldDefinition) => void
  onMove?: (from: number, to: number) => void
}

/** Ordered table of a module's fields with per-row actions for owners and admins. */
export function FieldList({ fields, canManage, busy, onEdit, onDelete, onMove }: FieldListProps) {
  return (
    <Table aria-label="Fields">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Label</TableHead>
          <TableHead className="hidden sm:table-cell">Key</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="hidden md:table-cell">Required</TableHead>
          <TableHead className="hidden lg:table-cell">Options</TableHead>
          {canManage ? (
            <TableHead className="w-32 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((field, index) => (
          <TableRow key={field.id} data-field-key={field.key}>
            <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
            <TableCell className="font-medium">{field.label}</TableCell>
            <TableCell className="text-muted-foreground hidden font-mono text-xs sm:table-cell">
              {field.key}
            </TableCell>
            <TableCell>
              <FieldTypeBadge type={field.type} />
            </TableCell>
            <TableCell className="hidden md:table-cell">
              {field.required ? (
                'Required'
              ) : (
                <span className="text-muted-foreground">Optional</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground hidden max-w-64 truncate lg:table-cell">
              {summariseField(field) || <span aria-hidden="true">—</span>}
            </TableCell>
            {canManage ? (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${field.label} up`}
                    disabled={busy || index === 0}
                    onClick={() => onMove?.(index, index - 1)}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${field.label} down`}
                    disabled={busy || index === fields.length - 1}
                    onClick={() => onMove?.(index, index + 1)}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${field.label}`}
                    disabled={busy}
                    onClick={() => onEdit?.(field)}
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${field.label}`}
                    disabled={busy}
                    onClick={() => onDelete?.(field)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function FieldListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading fields">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  )
}
