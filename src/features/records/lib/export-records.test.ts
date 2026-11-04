import { describe, expect, it } from 'vitest'

import {
  ExportError,
  buildExportBody,
  canExportRecords,
  describeExportError,
  exportErrorFromResponse,
  fallbackExportFileName,
  parseContentDispositionFileName,
} from './export-records'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('canExportRecords', () => {
  it('allows owners and admins only', () => {
    expect(canExportRecords('owner')).toBe(true)
    expect(canExportRecords('admin')).toBe(true)
    expect(canExportRecords('member')).toBe(false)
    expect(canExportRecords(null)).toBe(false)
  })
})

describe('buildExportBody', () => {
  it('omits an empty search and empty filters', () => {
    expect(buildExportBody('ws', 'mod', { search: '  ', filters: [] })).toEqual({
      workspaceId: 'ws',
      moduleId: 'mod',
    })
  })

  it('passes the trimmed search and the filters in the function shape', () => {
    const filters = [
      { kind: 'options' as const, key: 'status', values: ['lead'] },
      { kind: 'number-range' as const, key: 'value', min: 100, max: null },
      { kind: 'date-range' as const, key: 'due', min: null, max: '2026-12-31' },
      { kind: 'boolean' as const, key: 'vip', value: true },
      { kind: 'text' as const, key: 'company', value: 'acme' },
    ]
    expect(buildExportBody('ws', 'mod', { search: ' acme ', filters })).toEqual({
      workspaceId: 'ws',
      moduleId: 'mod',
      search: 'acme',
      filters,
    })
  })
})

describe('parseContentDispositionFileName', () => {
  it.each([
    ['attachment; filename="clients-2026-11-04.csv"', 'clients-2026-11-04.csv'],
    ['attachment; filename=clients-2026-11-04.csv', 'clients-2026-11-04.csv'],
    ['attachment;filename="a \\"quoted\\" name.csv"', 'a _quoted_ name.csv'],
    ["attachment; filename*=UTF-8''clients%20%C3%A9-2026-11-04.csv", 'clients é-2026-11-04.csv'],
    ['attachment; filename="fallback.csv"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.csv', 'résumé.csv'],
    ["attachment; filename*=utf-8'en'report.csv", 'report.csv'],
    ['ATTACHMENT; FILENAME="Upper.CSV"', 'Upper.CSV'],
  ])('%s -> %s', (header, expected) => {
    expect(parseContentDispositionFileName(header)).toBe(expected)
  })

  it('falls back to filename= when the extended value is malformed', () => {
    expect(
      parseContentDispositionFileName(
        'attachment; filename*=UTF-8\'\'bad%E0%A4; filename="ok.csv"',
      ),
    ).toBe('ok.csv')
  })

  it('strips path separators and returns null for missing or empty names', () => {
    expect(parseContentDispositionFileName('attachment; filename="../../evil.csv"')).toBe(
      '.._.._evil.csv',
    )
    expect(parseContentDispositionFileName('attachment')).toBeNull()
    expect(parseContentDispositionFileName('attachment; filename=""')).toBeNull()
    expect(parseContentDispositionFileName(null)).toBeNull()
  })
})

describe('fallbackExportFileName', () => {
  it('uses the slug and the UTC date', () => {
    expect(fallbackExportFileName('clients', new Date('2026-11-04T23:30:00Z'))).toBe(
      'clients-2026-11-04.csv',
    )
    expect(fallbackExportFileName('', new Date('2026-11-04T00:00:00Z'))).toBe(
      'records-2026-11-04.csv',
    )
  })
})

describe('exportErrorFromResponse', () => {
  it('reads the envelope code', async () => {
    const tooLarge = await exportErrorFromResponse(
      json(413, { error: { code: 'export_too_large', message: 'x', details: { limit: 50000 } } }),
    )
    expect(tooLarge).toBeInstanceOf(ExportError)
    expect(tooLarge.code).toBe('export_too_large')
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.message).toBe(
      'More than 50,000 records match. Narrow the search or filters and try again.',
    )
    expect((await exportErrorFromResponse(json(403, { error: { code: 'forbidden' } }))).code).toBe(
      'forbidden',
    )
    expect(
      (await exportErrorFromResponse(json(400, { error: { code: 'validation_error' } }))).code,
    ).toBe('validation_error')
  })

  it('falls back to the status for foreign bodies (edge runtime 401) and non-JSON', async () => {
    expect(
      (await exportErrorFromResponse(json(401, { code: 'UNAUTHORIZED_INVALID_JWT_FORMAT' }))).code,
    ).toBe('unauthorized')
    expect((await exportErrorFromResponse(new Response('nope', { status: 413 }))).code).toBe(
      'export_too_large',
    )
    expect((await exportErrorFromResponse(new Response('', { status: 502 }))).code).toBe('internal')
  })

  it('has a message for every code', () => {
    for (const code of [
      'forbidden',
      'export_too_large',
      'validation_error',
      'unauthorized',
      'network',
      'internal',
    ] as const) {
      expect(describeExportError(code).length).toBeGreaterThan(10)
    }
  })
})
