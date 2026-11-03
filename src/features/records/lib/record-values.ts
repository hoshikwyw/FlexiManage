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

export function sameCustomValues(a: CustomValues, b: CustomValues): boolean {
  return stableStringify(compactCustomValues(a)) === stableStringify(compactCustomValues(b))
}

export interface RecordPayload {
  title: string
  status: string | null
  custom_values: { [key: string]: Json }
}

/**
 * The columns of `next` that differ from `current`. Only those are sent, so a
 * title-only edit of a stale record (a required field added later) does not
 * resend `custom_values` and is accepted by the server.
 */
export function diffRecordPayload(
  current: { title: string; status: string | null; custom_values: Json },
  next: RecordPayload,
): Partial<RecordPayload> {
  const changes: Partial<RecordPayload> = {}
  if (current.title !== next.title) changes.title = next.title
  if ((current.status ?? null) !== next.status) changes.status = next.status
  if (!sameCustomValues(readCustomValues(current.custom_values), next.custom_values)) {
    changes.custom_values = next.custom_values
  }
  return changes
}
