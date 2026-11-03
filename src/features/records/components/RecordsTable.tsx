import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatFieldValue } from '@/features/records/fields/registry'
import { formatDate } from '@/lib/format'
import type { FieldDefinition } from '@/types/database'

import { fieldSortKey } from '../lib/records-query'
import { readCustomValues } from '../lib/record-values'
import type { RecordItem, RecordSort } from '../types'

interface RecordsTableProps {
  fields: readonly FieldDefinition[]
  rows: readonly RecordItem[]
  sort: RecordSort
  onSort: (by: RecordSort['by']) => void
  /** Opens a record (row click or Enter on a focused row). */
  onOpen: (recordId: string) => void
  /** Link target of the title cell (open in a new tab, assistive technology). */
  recordHref: (recordId: string) => string
  /** True while a new page loads over the previous one. */
  busy?: boolean
}

interface Column {
  id: string
  label: string
  sortBy: RecordSort['by']
}

function SortIcon({ direction }: { direction: RecordSort['dir'] | null }) {
  if (direction === 'asc') return <ArrowUpIcon aria-hidden="true" className="size-3.5" />
  if (direction === 'desc') return <ArrowDownIcon aria-hidden="true" className="size-3.5" />
  return <ArrowUpDownIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
}

/**
 * Records of one page: title, every field in position order (formatted by the
 * registry), then the last update. Headers sort server-side and expose
 * `aria-sort`; a row opens the record on click or Enter. Loading, empty and
 * error states live in `RecordsTableStates`.
 */
export function RecordsTable({
  fields,
  rows,
  sort,
  onSort,
  onOpen,
  recordHref,
  busy,
}: RecordsTableProps) {
  const columns: Column[] = [
    { id: 'title', label: 'Title', sortBy: 'title' },
    ...fields.map((field) => ({
      id: field.id,
      label: field.label,
      sortBy: fieldSortKey(field.key),
    })),
    { id: 'updated_at', label: 'Updated', sortBy: 'updated_at' },
  ]

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, recordId: string) {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      onOpen(recordId)
    }
  }

  return (
    <div className="rounded-lg border" aria-busy={busy || undefined}>
      <Table aria-label="Records">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const direction = sort.by === column.sortBy ? sort.dir : null
              return (
                <TableHead
                  key={column.id}
                  aria-sort={
                    direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
                  }
                >
                  <button
                    type="button"
                    className="focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1 rounded-sm px-1 outline-none hover:underline focus-visible:ring-3"
                    onClick={() => onSort(column.sortBy)}
                  >
                    {column.label}
                    <SortIcon direction={direction} />
                  </button>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={busy ? 'opacity-60' : undefined}>
          {rows.map((record) => {
            const values = readCustomValues(record.custom_values)
            return (
              <TableRow
                key={record.id}
                data-record-id={record.id}
                tabIndex={0}
                className="focus-visible:ring-ring/50 cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-inset"
                onClick={() => onOpen(record.id)}
                onKeyDown={(event) => handleKeyDown(event, record.id)}
              >
                <TableCell className="max-w-64 truncate font-medium">
                  <Link
                    to={recordHref(record.id)}
                    tabIndex={-1}
                    className="hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {record.title}
                  </Link>
                </TableCell>
                {fields.map((field) => (
                  <TableCell key={field.id} className="max-w-64 truncate">
                    {formatFieldValue(values[field.key], field)}
                  </TableCell>
                ))}
                <TableCell className="text-muted-foreground">
                  {formatDate(record.updated_at)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
