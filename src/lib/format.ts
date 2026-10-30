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
