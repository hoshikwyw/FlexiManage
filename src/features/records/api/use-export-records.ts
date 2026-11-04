import { useMutation } from '@tanstack/react-query'

import { saveBlob } from '@/lib/download'
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'

import {
  ExportError,
  buildExportBody,
  exportErrorFromResponse,
  fallbackExportFileName,
  parseContentDispositionFileName,
} from '../lib/export-records'
import type { RecordsQuery } from '../types'

export interface ExportRecordsInput {
  workspaceId: string
  moduleId: string
  /** For the fallback file name when `Content-Disposition` is missing. */
  moduleSlug: string
  query: Pick<RecordsQuery, 'search' | 'filters'>
}

export interface ExportRecordsResult {
  fileName: string
}

/**
 * Calls `export-records` with a raw `fetch` (not `functions.invoke`, which
 * would parse the body and drop the response headers) and saves the CSV.
 * The caller's JWT authorises the export; the function re-checks owner/admin.
 */
export async function exportRecords({
  workspaceId,
  moduleId,
  moduleSlug,
  query,
}: ExportRecordsInput): Promise<ExportRecordsResult> {
  const { data, error } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (error || !accessToken) throw new ExportError('unauthorized')

  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/export-records`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildExportBody(workspaceId, moduleId, query)),
    })
  } catch {
    throw new ExportError('network')
  }
  if (!response.ok) throw await exportErrorFromResponse(response)

  let blob: Blob
  try {
    blob = await response.blob()
  } catch {
    throw new ExportError('network')
  }
  const fileName =
    parseContentDispositionFileName(response.headers.get('Content-Disposition')) ??
    fallbackExportFileName(moduleSlug)
  saveBlob(blob, fileName)
  return { fileName }
}

/** Export the module's records matching the current search and filters as CSV. */
export function useExportRecords() {
  return useMutation({ mutationFn: exportRecords })
}
