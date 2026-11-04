import { PlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { useFieldDefinitions } from '@/features/modules/api/use-field-definitions'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'
import type { FieldDefinition, WorkspaceRole } from '@/types/database'

import { useRecords } from '../api/use-records'
import { useRecordsUrlState } from '../hooks/use-records-url-state'
import { lastPage } from '../lib/pagination'
import { hasActiveCriteria, nextSort, withFilter, withoutCriteria } from '../lib/records-query'
import { ExportCsvButton } from './ExportCsvButton'
import { RecordsPagination } from './RecordsPagination'
import { RecordsTable } from './RecordsTable'
import {
  RecordsEmpty,
  RecordsError,
  RecordsNoMatch,
  RecordsTableSkeleton,
} from './RecordsTableStates'
import { RecordsToolbar } from './RecordsToolbar'

/** Pause after the last keystroke before the search reaches the URL and the server. */
const SEARCH_DEBOUNCE_MS = 300

interface RecordsTabProps {
  workspaceId: string
  moduleId: string
  /** For the export file name fallback. */
  moduleSlug?: string
  /** The caller's role: "Export CSV" is shown to owners and admins only. */
  role?: WorkspaceRole | null
}

/** The Records tab of a module: waits for the field definitions, then renders the list. */
export function RecordsTab({ workspaceId, moduleId, moduleSlug, role }: RecordsTabProps) {
  const fields = useFieldDefinitions(workspaceId, moduleId)

  if (fields.isPending) return <RecordsTableSkeleton columns={4} />
  if (fields.isError) return <RecordsError onRetry={() => void fields.refetch()} />
  return (
    <RecordsList
      workspaceId={workspaceId}
      moduleId={moduleId}
      moduleSlug={moduleSlug}
      role={role}
      fields={fields.data}
    />
  )
}

/**
 * Toolbar, table and pagination. The view state lives in the URL
 * (`useRecordsUrlState`); the search box is local and written to the URL after
 * a 300 ms pause. Changing search or filters goes back to page 1.
 */
export function RecordsList({
  workspaceId,
  moduleId,
  moduleSlug = '',
  role = null,
  fields,
}: RecordsTabProps & { fields: FieldDefinition[] }) {
  const navigate = useNavigate()
  const { query, setQuery } = useRecordsUrlState(fields)
  const records = useRecords(workspaceId, moduleId, query)

  // Search box: local text, synced from the URL when it changes elsewhere
  // ("Clear all", back/forward) and written to the URL 300 ms after the last
  // keystroke. The URL holds the trimmed term, so the box is only overwritten
  // when it means something else: "acme " stays as typed when the URL becomes
  // "acme". The timer calls the latest `setQuery` through a ref.
  const [searchText, setSearchText] = useState(query.search)
  const [urlSearch, setUrlSearch] = useState(query.search)
  if (urlSearch !== query.search) {
    setUrlSearch(query.search)
    if (searchText.trim() !== query.search) setSearchText(query.search)
  }
  const setQueryRef = useRef(setQuery)
  const searchTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    setQueryRef.current = setQuery
  }, [setQuery])
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])

  function handleSearchChange(value: string) {
    setSearchText(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      const search = value.trim()
      setQueryRef.current((current) =>
        current.search === search ? current : { ...current, search, page: 1 },
      )
    }, SEARCH_DEBOUNCE_MS)
  }

  // A page past the end (records deleted, stale link): jump to the last page.
  const outOfRange = records.data?.outOfRange === true
  const total = records.data?.total ?? 0
  useEffect(() => {
    if (outOfRange) {
      setQuery((current) => ({ ...current, page: lastPage(current.pageSize, total) }))
    }
  }, [outOfRange, total, setQuery])

  const createHref = WORKSPACE_ROUTES.newRecord(workspaceId, moduleId)
  const recordHref = (recordId: string) => WORKSPACE_ROUTES.record(workspaceId, moduleId, recordId)
  const clearAll = () => {
    window.clearTimeout(searchTimer.current)
    setSearchText('')
    setQuery(withoutCriteria)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <RecordsToolbar
            fields={fields}
            search={searchText}
            onSearchChange={handleSearchChange}
            filters={query.filters}
            onFilterChange={(key, filter) =>
              setQuery((current) => withFilter(current, key, filter))
            }
            onClearAll={clearAll}
          />
        </div>
        <div className="flex gap-2">
          <ExportCsvButton
            workspaceId={workspaceId}
            moduleId={moduleId}
            moduleSlug={moduleSlug}
            role={role}
            query={query}
            disabled={records.isPending || total === 0}
          />
          <Link to={createHref} className={buttonVariants()}>
            <PlusIcon aria-hidden="true" />
            New record
          </Link>
        </div>
      </div>

      {records.isPending ? (
        <RecordsTableSkeleton columns={fields.length + 2} />
      ) : records.isError ? (
        <RecordsError onRetry={() => void records.refetch()} />
      ) : records.data.rows.length === 0 && !outOfRange ? (
        hasActiveCriteria(query) ? (
          <RecordsNoMatch onClear={clearAll} />
        ) : (
          <RecordsEmpty createHref={createHref} />
        )
      ) : (
        <>
          <RecordsTable
            fields={fields}
            rows={records.data.rows}
            sort={query.sort}
            onSort={(by) =>
              setQuery((current) => ({ ...current, sort: nextSort(current.sort, by), page: 1 }))
            }
            onOpen={(recordId) => void navigate(recordHref(recordId))}
            recordHref={recordHref}
            busy={records.isPlaceholderData}
          />
          <RecordsPagination
            page={query.page}
            pageSize={query.pageSize}
            total={records.data.total}
            onPageChange={(page) => setQuery((current) => ({ ...current, page }))}
            onPageSizeChange={(pageSize) =>
              setQuery((current) => ({ ...current, pageSize, page: 1 }))
            }
          />
        </>
      )}
    </div>
  )
}
