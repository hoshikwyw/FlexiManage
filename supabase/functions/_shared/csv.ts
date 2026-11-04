/**
 * CSV building blocks for `export-records` (B5). Pure functions with no Deno or
 * Supabase imports, so they can be unit-tested (`csv.test.ts`) and reused.
 *
 * Format: UTF-8 with a byte order mark (so Excel detects the encoding), RFC 4180
 * quoting, CRLF after every row (including the last), formula-injection guard on
 * text cells.
 */

/** Byte order mark written once at the start of the file. */
export const CSV_BOM = '﻿'

/** Line terminator required by RFC 4180. */
export const CSV_EOL = '\r\n'

/**
 * Characters that make spreadsheet applications evaluate a cell, including the fullwidth forms
 * (U+FF1D, U+FF0B, U+FF0D, U+FF20) that some applications normalise to ASCII.
 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '＝', '＋', '－', '＠'])

/**
 * Leading characters skipped before looking for a trigger: every whitespace character JavaScript
 * knows (`\s` covers tab, CR, LF, NBSP, U+1680, U+2000-200A, U+2028/2029, U+202F, U+205F, U+3000,
 * U+FEFF) and quote characters (a cell like `"=cmd` or `'=cmd` is still evaluated by some
 * importers once the quote is stripped).
 */
const LEADING_NOISE = /^[\s"'‘’“”]+/u

/**
 * Prefixes a text cell with a single quote when it starts with tab or carriage return, or when its
 * first character after leading whitespace and quotes is `=`, `+`, `-`, `@` or a fullwidth form of
 * them (CSV/formula injection, OWASP). Apply it to every cell that holds user text; numbers
 * produced by `formatNumber` are exempt so a negative amount stays a number.
 */
export function neutralizeFormula(value: string): string {
  if (value.length === 0) return value
  if (value[0] === '\t' || value[0] === '\r') return `'${value}`
  const first = value.replace(LEADING_NOISE, '')[0]
  return first !== undefined && FORMULA_TRIGGERS.has(first) ? `'${value}` : value
}

/**
 * RFC 4180 field encoding: a field that contains a double quote, comma, CR or
 * LF is wrapped in double quotes with inner quotes doubled; anything else is
 * written as is.
 */
export function quoteField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A cell: user text (guarded against formulas) or a pre-formatted safe number. */
export type CsvCell = { kind: 'text'; value: string } | { kind: 'number'; value: string }

export const textCell = (value: string): CsvCell => ({ kind: 'text', value })
export const emptyCell: CsvCell = { kind: 'text', value: '' }

/** One row, encoded and terminated with CRLF. */
export function csvRow(cells: readonly CsvCell[]): string {
  return (
    cells
      .map((cell) => quoteField(cell.kind === 'text' ? neutralizeFormula(cell.value) : cell.value))
      .join(',') + CSV_EOL
  )
}

/**
 * A finite number as a plain decimal with a dot and no grouping, for
 * spreadsheets: `12500.5`, `-3`, `0`. Exponent notation (`1e+21`, `1e-7`) is
 * expanded so every value parses as a number. Non-finite input yields null.
 */
export function formatNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null
  const plain = String(value)
  if (!/e/i.test(plain)) return plain
  // Up to 20 fraction digits covers every double in toFixed's range; trim zeros.
  const fixed = Math.abs(value) >= 1e21 ? BigInt(Math.round(value)).toString() : value.toFixed(20)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

/** A timestamp from Postgres as ISO 8601 UTC (`2026-11-04T09:30:00.000Z`). */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

/** Field definition subset the formatter needs. */
export interface CsvField {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'currency'
  options: unknown
}

/** Option value -> label for a select field; tolerant of malformed JSON. */
export function optionLabels(options: unknown): Map<string, string> {
  const labels = new Map<string, string>()
  if (!Array.isArray(options)) return labels
  for (const option of options) {
    if (option && typeof option === 'object') {
      const { value, label } = option as { value?: unknown; label?: unknown }
      if (typeof value === 'string' && typeof label === 'string') labels.set(value, label)
    }
  }
  return labels
}

/**
 * Formats one custom value for the spreadsheet:
 * text raw; select the current option label (the stored value when the option
 * was removed); checkbox `TRUE` / `FALSE`; number and currency plain decimals;
 * date `YYYY-MM-DD` as stored. Missing, null or mistyped values are empty.
 */
export function formatFieldCell(
  value: unknown,
  field: CsvField,
  labels?: Map<string, string>,
): CsvCell {
  if (value === null || value === undefined) return emptyCell
  switch (field.type) {
    case 'number':
    case 'currency': {
      const formatted = typeof value === 'number' ? formatNumber(value) : null
      return formatted === null ? emptyCell : { kind: 'number', value: formatted }
    }
    case 'checkbox':
      return typeof value === 'boolean' ? textCell(value ? 'TRUE' : 'FALSE') : emptyCell
    case 'select': {
      if (typeof value !== 'string') return emptyCell
      return textCell((labels ?? optionLabels(field.options)).get(value) ?? value)
    }
    case 'date':
    case 'text':
      return typeof value === 'string' ? textCell(value) : emptyCell
  }
}

/** Record subset the exporter reads. */
export interface CsvRecord {
  title: string
  status: string | null
  custom_values: unknown
  created_at: string
  updated_at: string
}

/** Header row: Title, Record status, field labels in position order, Created at, Updated at. */
export function headerCells(fields: readonly CsvField[]): CsvCell[] {
  return [
    textCell('Title'),
    textCell('Record status'),
    ...fields.map((field) => textCell(field.label)),
    textCell('Created at'),
    textCell('Updated at'),
  ]
}

/** One record as cells in header order. */
export function recordCells(
  record: CsvRecord,
  fields: readonly CsvField[],
  labelsByKey: ReadonlyMap<string, Map<string, string>> = new Map(),
): CsvCell[] {
  const values =
    record.custom_values && typeof record.custom_values === 'object'
      ? (record.custom_values as Record<string, unknown>)
      : {}
  return [
    textCell(record.title),
    textCell(record.status ?? ''),
    ...fields.map((field) => formatFieldCell(values[field.key], field, labelsByKey.get(field.key))),
    textCell(formatTimestamp(record.created_at)),
    textCell(formatTimestamp(record.updated_at)),
  ]
}

/** Option labels of every select field, keyed by field key (computed once per export). */
export function selectLabelsByKey(fields: readonly CsvField[]): Map<string, Map<string, string>> {
  return new Map(
    fields.filter((f) => f.type === 'select').map((f) => [f.key, optionLabels(f.options)]),
  )
}

/** Start of the document: BOM and header row. Streaming writers send this first. */
export function csvPreamble(fields: readonly CsvField[]): string {
  return CSV_BOM + csvRow(headerCells(fields))
}

/** Rows for a page of records, each CRLF-terminated. */
export function csvRecordRows(
  records: readonly CsvRecord[],
  fields: readonly CsvField[],
  labelsByKey: ReadonlyMap<string, Map<string, string>> = selectLabelsByKey(fields),
): string {
  let out = ''
  for (const record of records) out += csvRow(recordCells(record, fields, labelsByKey))
  return out
}

/** Whole document: BOM, header, one row per record (`csvPreamble` + `csvRecordRows`). */
export function buildCsv(fields: readonly CsvField[], records: readonly CsvRecord[]): string {
  return csvPreamble(fields) + csvRecordRows(records, fields)
}

/**
 * `<module-slug>-YYYY-MM-DD.csv` (UTC date). The slug is already
 * `^[a-z0-9]+(-[a-z0-9]+)*$` in the database; anything else is replaced so the
 * Content-Disposition header can never be broken by the name.
 */
export function exportFileName(slug: string, now: Date = new Date()): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, '-').replace(/^-+|-+$/g, '') || 'export'
  return `${safe}-${now.toISOString().slice(0, 10)}.csv`
}
