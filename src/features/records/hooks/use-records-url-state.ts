import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { FieldDefinition } from '@/types/database'

import { parseRecordsQuery, serialiseRecordsQuery } from '../lib/records-query'
import type { RecordsQuery } from '../types'

/**
 * The records list view state, read from and written to the URL search
 * parameters (`lib/records-query.ts`), so a view can be shared and survives a
 * reload. Updates replace the history entry and are skipped when nothing
 * changes; parameters outside the records contract (such as `tab`) are kept.
 */
export function useRecordsUrlState(fields: readonly FieldDefinition[]) {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = useMemo(() => parseRecordsQuery(searchParams, fields), [searchParams, fields])

  const setQuery = useCallback(
    (update: (current: RecordsQuery) => RecordsQuery) => {
      const next = serialiseRecordsQuery(update(query), searchParams)
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true })
      }
    },
    [query, searchParams, setSearchParams],
  )

  return { query, setQuery }
}
