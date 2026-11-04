import { isPostgrestError } from '@/lib/postgrest-errors'

import { sameValue, type RecordFormState } from './record-values'

/**
 * `update_record` raises SQLSTATE `PT409` (message `record_changed`) when the
 * row's `updated_at` no longer equals `p_expected_updated_at`: someone saved
 * the record after this edit form opened.
 */
export function isRecordConflict(error: unknown): boolean {
  return isPostgrestError(error) && (error.code === 'PT409' || error.message === 'record_changed')
}

export const RECORD_CONFLICT_MESSAGE =
  'This record was changed by someone else. Reload to see the latest version; your edits are kept in the form.'
export const RECORD_RELOADED_MESSAGE =
  'Loaded the latest version. Fields you had changed keep your edits; review them and save again.'
export const RECORD_RELOAD_FAILED_MESSAGE =
  'The latest version could not be loaded. Check your connection and try again.'

/** A form path of `RecordFormValues`. */
export type RecordFormPath = 'title' | 'status' | `custom_values.${string}`

export interface RebasedFormValues {
  values: RecordFormState
  /** Paths whose value is the user's edit rather than the latest version's. */
  kept: RecordFormPath[]
}

/**
 * Three-way merge after a conflict: start from `latest` (the record as it is
 * now) and keep the user's value wherever `current` (what the form holds)
 * differs from `base` (the version the user started editing). Fields the user
 * did not touch take the other person's changes; fields the user changed keep
 * the user's edit, even if the other person changed them too (the user sees
 * them before saving again).
 */
export function rebaseFormValues(
  base: RecordFormState,
  current: RecordFormState,
  latest: RecordFormState,
): RebasedFormValues {
  const kept: RecordFormPath[] = []
  const values: RecordFormState = {
    title: latest.title,
    status: latest.status,
    custom_values: { ...latest.custom_values },
  }
  if (current.title !== base.title) {
    values.title = current.title
    kept.push('title')
  }
  if (current.status !== base.status) {
    values.status = current.status
    kept.push('status')
  }
  for (const [key, value] of Object.entries(current.custom_values)) {
    if (sameValue(value, base.custom_values[key])) continue
    values.custom_values[key] = value
    kept.push(`custom_values.${key}`)
  }
  return { values, kept }
}
