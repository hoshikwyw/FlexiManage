const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** "30 Oct 2026" style date for an ISO timestamp. Invalid input renders as an empty string. */
export function formatDate(iso: string | null | undefined): string {
  const date = toDate(iso)
  return date ? dateFormatter.format(date) : ''
}

/** Date plus time, for activity feeds. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = toDate(iso)
  return date ? dateTimeFormatter.format(date) : ''
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Parses a `YYYY-MM-DD` string as a calendar date (local time, no timezone
 * shift) and rejects impossible dates such as `2026-02-30`. Returns null for
 * anything else.
 */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return valid ? date : null
}

/** "4 Nov 2026" style date for a `YYYY-MM-DD` value. Invalid input renders as an empty string. */
export function formatDateOnly(value: string | null | undefined): string {
  const date = parseIsoDate(value)
  return date ? dateFormatter.format(date) : ''
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const

/**
 * Human-readable size in 1024-based units, the way Windows and the 10 MB
 * attachment limit (10,485,760 bytes) count: `0 B`, `512 B`, `1.5 KB`,
 * `12.3 MB`, `10 MB`. One decimal below 100 in a unit, none above; a trailing
 * `.0` is dropped. Negative or non-finite input renders `0 B`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let value = bytes
  let unit: (typeof BYTE_UNITS)[number] = 'KB'
  for (const next of BYTE_UNITS) {
    value /= 1024
    unit = next
    if (value < 1023.95) break
  }
  const text = value < 99.95 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value).toString()
  return `${text} ${unit}`
}
