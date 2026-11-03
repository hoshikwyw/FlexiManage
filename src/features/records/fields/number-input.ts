/**
 * Raw input text to stored number. Empty (or whitespace) means "no value" and
 * becomes null; anything that is not a finite number is kept as the raw string
 * so the schema reports it instead of silently dropping it.
 */
export function parseNumberInput(raw: string): number | string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : raw
}

/** `step` attribute for a precision: 0 -> "1", 2 -> "0.01", undefined -> "any". */
export function stepForPrecision(precision: number | undefined): string {
  if (precision === undefined) return 'any'
  return precision === 0 ? '1' : `0.${'0'.repeat(precision - 1)}1`
}
