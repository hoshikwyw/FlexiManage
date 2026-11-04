import type { CustomValues } from '@/features/records/fields/build-record-schema'
import type { Json } from '@/types/supabase'

/**
 * `custom_values` as sent to the server: keys whose value is "no value"
 * (`undefined`, `null`, `''`) are left out. The server treats absence and null
 * alike, and leaving them out keeps JSON nulls out of numeric range filters.
 */
export function compactCustomValues(values: CustomValues): { [key: string]: Json } {
  const compact: { [key: string]: Json } = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    compact[key] = value as Json
  }
  return compact
}

/** Narrows the stored `custom_values` JSON to an object (anything else reads as empty). */
export function readCustomValues(value: Json | undefined): CustomValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {}
}

/** `undefined`, `null` and `''` all mean "no value" (absent from `custom_values`). */
export function isEmptyValue(value: unknown): value is undefined | null | '' {
  return value === undefined || value === null || value === ''
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Equal stored values; every "no value" form counts as the same. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) || isEmptyValue(b)) return isEmptyValue(a) && isEmptyValue(b)
  return stableStringify(a) === stableStringify(b)
}

export interface RecordPayload {
  title: string
  status: string | null
  custom_values: { [key: string]: Json }
}

/**
 * `p_patch` of `update_record`: every key optional. `status: null` clears the
 * status; `set` writes custom values, `unset` removes keys.
 */
// A type alias, not an interface, so it is assignable to the generated `Json` (`p_patch`).
export type RecordPatch = {
  title?: string
  status?: string | null
  set?: { [key: string]: Json }
  unset?: string[]
}

/** The editable part of a record as the form holds it (`RecordFormValues`). */
export interface RecordFormState {
  title: string
  status: string
  custom_values: CustomValues
}

function normaliseStatus(status: string): string | null {
  const trimmed = status.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The patch for an edit: `next` (the parsed form values) diffed against
 * `snapshot` (the record's form values when the edit form opened, not the
 * latest cache). Only changed core fields and changed custom keys are sent;
 * a key cleared to empty goes into `unset`. Untouched fields are never sent,
 * so a title-only edit of a record whose checkbox was never set, or of a stale
 * record missing a required value, sends `{ title }` alone.
 */
export function buildRecordPatch(snapshot: RecordFormState, next: RecordFormState): RecordPatch {
  const patch: RecordPatch = {}
  const title = next.title.trim()
  if (title !== snapshot.title.trim()) patch.title = title
  const status = normaliseStatus(next.status)
  if (status !== normaliseStatus(snapshot.status)) patch.status = status

  const set: { [key: string]: Json } = {}
  const unset: string[] = []
  const keys = new Set([...Object.keys(snapshot.custom_values), ...Object.keys(next.custom_values)])
  for (const key of keys) {
    const after = next.custom_values[key]
    if (sameValue(snapshot.custom_values[key], after)) continue
    if (isEmptyValue(after)) unset.push(key)
    else set[key] = after as Json
  }
  if (Object.keys(set).length > 0) patch.set = set
  if (unset.length > 0) patch.unset = unset
  return patch
}

export function isEmptyPatch(patch: RecordPatch): boolean {
  return Object.keys(patch).length === 0
}
