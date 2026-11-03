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
