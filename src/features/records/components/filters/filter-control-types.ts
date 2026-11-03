import { useState } from 'react'

import type { FieldDefinition } from '@/types/database'

import { filterToParamValues } from '../../lib/records-query'
import type { RecordFilter } from '../../types'

/** Props of every filter control in `FILTER_CONTROLS`. */
export interface FilterControlProps {
  field: FieldDefinition
  /** The active filter on this field, if any. */
  filter: RecordFilter | undefined
  /** New filter, or null to remove it. */
  onChange: (filter: RecordFilter | null) => void
}

/**
 * Local draft for a filter typed by the user (text, ranges), committed on
 * Enter or blur. The draft resets whenever the applied filter changes from
 * outside (chip removed, "Clear all", back/forward).
 */
export function useFilterDraft<T>(filter: RecordFilter | undefined, toDraft: () => T) {
  const signature = filter ? filterToParamValues(filter).join('\u0000') : ''
  const [draft, setDraft] = useState(toDraft)
  const [seen, setSeen] = useState(signature)
  if (seen !== signature) {
    setSeen(signature)
    setDraft(toDraft())
  }
  return [draft, setDraft] as const
}
