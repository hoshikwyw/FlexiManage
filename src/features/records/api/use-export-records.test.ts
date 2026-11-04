import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { createTestSession } from '@/test/supabase-mock'

import { exportRecords } from './use-export-records'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
  }
})

const fetchMock = vi.fn<typeof fetch>()
const BOM_CSV = '﻿Title,Record status\r\nAcme,lead\r\n'
const input = {
  workspaceId: 'ws-1',
  moduleId: 'mod-1',
  moduleSlug: 'clients',
  query: {
    search: 'acme',
    filters: [{ kind: 'options' as const, key: 'status', values: ['lead'] }],
  },
}

let saved: { href: string; download: string }[]

beforeEach(() => {
  saved = []
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: createTestSession() },
    error: null,
  } as never)
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/123')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ href: this.href, download: this.download })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function csvResponse(disposition: string | null) {
  const headers = new Headers({ 'Content-Type': 'text/csv; charset=utf-8' })
  if (disposition) headers.set('Content-Disposition', disposition)
  return new Response(BOM_CSV, { status: 200, headers })
}

describe('exportRecords', () => {
  it('posts the query to the function with the session token and the anon key', async () => {
    fetchMock.mockResolvedValue(csvResponse('attachment; filename="clients-2026-11-04.csv"'))
    await exportRecords(input)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:54321/functions/v1/export-records')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      Authorization: 'Bearer test-access-token',
      apikey: 'anon-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      workspaceId: 'ws-1',
      moduleId: 'mod-1',
      search: 'acme',
      filters: [{ kind: 'options', key: 'status', values: ['lead'] }],
    })
  })

  it('omits search and filters when the view has none', async () => {
    fetchMock.mockResolvedValue(csvResponse(null))
    await exportRecords({ ...input, query: { search: '', filters: [] } })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workspaceId: 'ws-1',
      moduleId: 'mod-1',
    })
  })

  it('saves the blob under the Content-Disposition name and revokes the object URL', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValue(
        csvResponse("attachment; filename*=UTF-8''clients-2026-11-04.csv"),
      )
      const result = await exportRecords(input)
      expect(result).toEqual({ fileName: 'clients-2026-11-04.csv' })
      expect(saved).toEqual([
        { href: 'blob:http://localhost/123', download: 'clients-2026-11-04.csv' },
      ])
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob
      const bytes = new Uint8Array(await blob.arrayBuffer())
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/123')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to <slug>-<UTC date>.csv without a Content-Disposition header', async () => {
    fetchMock.mockResolvedValue(csvResponse(null))
    const result = await exportRecords(input)
    expect(result.fileName).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(saved[0]?.download).toBe(result.fileName)
  })

  it('maps 413 export_too_large and saves nothing', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'export_too_large', message: 'x', details: { limit: 50000 } },
        }),
        { status: 413, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await expect(exportRecords(input)).rejects.toMatchObject({
      name: 'ExportError',
      code: 'export_too_large',
      message: 'More than 50,000 records match. Narrow the search or filters and try again.',
    })
    expect(saved).toEqual([])
  })

  it('maps 403 forbidden', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'forbidden', message: 'x' } }), { status: 403 }),
    )
    await expect(exportRecords(input)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('maps a failed fetch to network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(exportRecords(input)).rejects.toMatchObject({ code: 'network' })
  })

  it('does not call the function without a session', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never)
    await expect(exportRecords(input)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
