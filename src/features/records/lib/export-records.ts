import { NETWORK_ERROR_MESSAGE } from '@/lib/postgrest-errors'
import type { WorkspaceRole } from '@/types/database'

import type { RecordFilter, RecordsQuery } from '../types'

/**
 * Client side of the Edge Function `export-records` (story B5,
 * docs/architecture.md "export-records"). Pure: the request body, the file
 * name and the error mapping; the hook does the fetch and the save.
 */

/** Body of `POST /functions/v1/export-records`; empty search and filters are omitted. */
export interface ExportRecordsBody {
  workspaceId: string
  moduleId: string
  search?: string
  filters?: RecordFilter[]
}

/** Row cap of the function (`export_too_large` above it). */
export const EXPORT_ROW_LIMIT = 50_000

/**
 * Mirror of the function's role check (owner or admin; members get 403).
 * Hides the button only.
 */
export function canExportRecords(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * The same search and filters the table shows (sort and page do not matter:
 * the export is every matching row in `created_at, id` order). The filter
 * objects already have the function's shape (`RecordFilter`).
 */
export function buildExportBody(
  workspaceId: string,
  moduleId: string,
  query: Pick<RecordsQuery, 'search' | 'filters'>,
): ExportRecordsBody {
  const body: ExportRecordsBody = { workspaceId, moduleId }
  const search = query.search.trim()
  if (search) body.search = search
  if (query.filters.length > 0) body.filters = query.filters
  return body
}

/** Characters a saved file name must not contain on common systems. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped
const UNSAFE_FILE_NAME = /[/\\:*?"<>|\u0000-\u001f]/g

function safeFileName(name: string): string | null {
  const cleaned = name.replace(UNSAFE_FILE_NAME, '_').trim()
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : null
}

/**
 * File name from a `Content-Disposition` header: the RFC 5987 form
 * `filename*=UTF-8''clients-2026-11-04.csv` wins over `filename="..."` and a
 * bare `filename=...`. Returns null when there is none or it is unusable.
 */
export function parseContentDispositionFileName(header: string | null | undefined): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (extended?.[2]) {
    try {
      const decoded = safeFileName(decodeURIComponent(extended[2].trim().replace(/^"|"$/g, '')))
      if (decoded) return decoded
    } catch {
      // Malformed percent-encoding: try the plain parameter.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)
  if (quoted?.[1] !== undefined) return safeFileName(quoted[1].replace(/\\(.)/g, '$1'))
  const bare = /filename\s*=\s*([^;\s]+)/i.exec(header)
  if (bare?.[1]) return safeFileName(bare[1])
  return null
}

/** `<module-slug>-YYYY-MM-DD.csv` with the UTC date, like the function. */
export function fallbackExportFileName(moduleSlug: string, now: Date = new Date()): string {
  return `${moduleSlug || 'records'}-${now.toISOString().slice(0, 10)}.csv`
}

export type ExportErrorCode =
  'forbidden' | 'export_too_large' | 'validation_error' | 'unauthorized' | 'network' | 'internal'

export class ExportError extends Error {
  readonly code: ExportErrorCode
  readonly status: number | null

  constructor(code: ExportErrorCode, status: number | null = null) {
    super(describeExportError(code))
    this.name = 'ExportError'
    this.code = code
    this.status = status
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ExportErrorCode>([
  'forbidden',
  'export_too_large',
  'validation_error',
  'unauthorized',
  'internal',
])

const STATUS_TO_CODE: Record<number, ExportErrorCode> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'forbidden',
  413: 'export_too_large',
}

/**
 * Maps a non-2xx response: the envelope `{ error: { code } }` when it is
 * ours, otherwise the HTTP status (the edge runtime answers a bad JWT with
 * its own 401 body).
 */
export async function exportErrorFromResponse(response: Response): Promise<ExportError> {
  let code: ExportErrorCode | undefined
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null
    const bodyCode = body?.error?.code
    if (typeof bodyCode === 'string' && KNOWN_CODES.has(bodyCode)) {
      code = bodyCode as ExportErrorCode
    }
  } catch {
    // Not JSON.
  }
  return new ExportError(code ?? STATUS_TO_CODE[response.status] ?? 'internal', response.status)
}

export function describeExportError(code: ExportErrorCode): string {
  switch (code) {
    case 'forbidden':
      return 'Only owners and admins can export records.'
    case 'export_too_large':
      return 'More than 50,000 records match. Narrow the search or filters and try again.'
    case 'validation_error':
      return 'The search or filters could not be exported. Clear them and try again.'
    case 'unauthorized':
      return 'Your session has expired. Sign in again to export.'
    case 'network':
      return NETWORK_ERROR_MESSAGE
    case 'internal':
      return 'The export failed. Please try again.'
  }
}
