/** "1–25 of 312" for a page; "0 records" when there is nothing to show. */
export function describePageRange(page: number, pageSize: number, total: number): string {
  if (total <= 0) return '0 records'
  const from = Math.min((page - 1) * pageSize + 1, total)
  const to = Math.min(page * pageSize, total)
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`
}

/** Last page number for a total (at least 1). */
export function lastPage(pageSize: number, total: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
