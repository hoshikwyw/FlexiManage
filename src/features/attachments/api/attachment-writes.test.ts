import { StorageApiError, StorageUnknownError } from '@supabase/storage-js'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { createQueryBuilderMock, type QueryBuilderMock } from '@/test/query-builder-mock'
import { createStorageBucketMock, type StorageBucketMock } from '@/test/supabase-mock'

import type { AttachmentRow } from '../types'
import { deleteAttachment, downloadAttachment, uploadAttachment } from './attachment-writes'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const WS = '00000000-0000-0000-0000-0000000000aa'
const RECORD = '00000000-0000-0000-0000-0000000e0001'
const ROW: AttachmentRow = {
  id: 'att-1',
  workspace_id: WS,
  record_id: RECORD,
  file_name: 'Resume.pdf',
  content_type: 'application/pdf',
  size_bytes: 5,
  storage_path: `${WS}/${RECORD}/att-1-Resume.pdf`,
  uploaded_by: 'user-a',
  created_at: '2026-11-04T09:00:00.000Z',
}

/** Shared log of table and storage calls, to assert their order. */
let log: string[]
let bucket: StorageBucketMock
let builders: QueryBuilderMock[]

function queueTables(...results: unknown[]) {
  builders = results.map((result) => createQueryBuilderMock(result))
  let index = 0
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const builder = builders[index++]
    if (!builder) throw new Error(`unexpected from(${table})`)
    const insert = builder.insert as (...args: unknown[]) => unknown
    const del = builder.delete as (...args: unknown[]) => unknown
    builder.insert = (...args: unknown[]) => {
      log.push(`${table}.insert`)
      return insert(...args)
    }
    builder.delete = (...args: unknown[]) => {
      log.push(`${table}.delete`)
      return del(...args)
    }
    return builder
  }) as never)
}

const pdf = (name = 'Résumé.pdf', type = 'application/pdf') => new File(['hello'], name, { type })

beforeEach(() => {
  log = []
  bucket = createStorageBucketMock()
  bucket.upload.mockImplementation(async () => {
    log.push('storage.upload')
    return { data: { path: ROW.storage_path }, error: null }
  })
  vi.mocked(supabase.storage.from).mockReturnValue(bucket as never)
})

afterEach(() => {
  vi.mocked(supabase.from).mockReset()
  vi.mocked(supabase.storage.from).mockClear()
})

describe('uploadAttachment', () => {
  it('inserts the row first, then uploads to its storage_path without upsert', async () => {
    queueTables({ data: ROW, error: null })
    const result = await uploadAttachment({
      workspaceId: WS,
      recordId: RECORD,
      file: pdf(),
      existingCount: 0,
    })

    expect(result).toEqual(ROW)
    expect(log).toEqual(['attachments.insert', 'storage.upload'])
    expect(builders[0]?.callsOf('insert')[0]?.[0]).toEqual({
      workspace_id: WS,
      record_id: RECORD,
      file_name: 'Resume.pdf',
      content_type: 'application/pdf',
      size_bytes: 5,
    })
    expect(builders[0]?.callsOf('select')[0]?.[0]).toMatch(/^id, workspace_id, record_id/)
    expect(builders[0]?.callsOf('single')).toHaveLength(1)
    expect(supabase.storage.from).toHaveBeenCalledWith('attachments')
    const [path, body, options] = bucket.upload.mock.calls[0] ?? []
    expect(path).toBe(ROW.storage_path)
    expect(body).toBeInstanceOf(File)
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false })
  })

  it('re-types the bytes when the browser type differs from the resolved one', async () => {
    queueTables({ data: { ...ROW, content_type: 'text/csv' }, error: null })
    await uploadAttachment({
      workspaceId: WS,
      recordId: RECORD,
      file: pdf('list.csv', 'application/vnd.ms-excel'),
      existingCount: 0,
    })
    const insert = builders[0]?.callsOf('insert')[0]?.[0] as { content_type: string }
    expect(insert.content_type).toBe('text/csv')
    const body = bucket.upload.mock.calls[0]?.[1] as Blob
    expect(body.type).toBe('text/csv')
    expect(body.size).toBe(5)
  })

  it('deletes the row again and rethrows the mapped error when the upload fails', async () => {
    queueTables({ data: ROW, error: null }, { data: null, error: null })
    bucket.upload.mockImplementation(async () => {
      log.push('storage.upload')
      return { data: null, error: new StorageApiError('Unauthorized', 400, '403') }
    })

    const promise = uploadAttachment({
      workspaceId: WS,
      recordId: RECORD,
      file: pdf(),
      existingCount: 0,
    })
    await expect(promise).rejects.toMatchObject({ name: 'AttachmentError', code: 'forbidden' })
    expect(log).toEqual(['attachments.insert', 'storage.upload', 'attachments.delete'])
    expect(builders[1]?.callsOf('eq')).toEqual([
      ['workspace_id', WS],
      ['id', ROW.id],
    ])
  })

  it('rolls back on a network failure too, and keeps the upload error if the rollback fails', async () => {
    queueTables({ data: ROW, error: null }, { data: null, error: null })
    const rollback = builders[1] as QueryBuilderMock
    rollback.then = (resolve, reject) =>
      Promise.reject(new TypeError('Failed to fetch')).then(resolve, reject)
    bucket.upload.mockImplementation(async () => {
      log.push('storage.upload')
      return {
        data: null,
        error: new StorageUnknownError('Failed to fetch', new TypeError('Failed to fetch')),
      }
    })
    await expect(
      uploadAttachment({ workspaceId: WS, recordId: RECORD, file: pdf(), existingCount: 0 }),
    ).rejects.toMatchObject({ code: 'network' })
    expect(log).toEqual(['attachments.insert', 'storage.upload', 'attachments.delete'])
  })

  it('uploads nothing when the row insert fails', async () => {
    queueTables({
      data: null,
      error: {
        code: '23514',
        message: 'attachments: at most 10 files per record',
        details: null,
        hint: null,
      },
    })
    await expect(
      uploadAttachment({ workspaceId: WS, recordId: RECORD, file: pdf(), existingCount: 3 }),
    ).rejects.toMatchObject({ code: 'too_many' })
    expect(log).toEqual(['attachments.insert'])
    expect(bucket.upload).not.toHaveBeenCalled()
  })

  it('validates before any request', async () => {
    queueTables()
    const exe = new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })
    await expect(
      uploadAttachment({ workspaceId: WS, recordId: RECORD, file: exe, existingCount: 0 }),
    ).rejects.toMatchObject({ code: 'type_not_allowed' })
    await expect(
      uploadAttachment({ workspaceId: WS, recordId: RECORD, file: pdf(), existingCount: 10 }),
    ).rejects.toMatchObject({ code: 'too_many' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(bucket.upload).not.toHaveBeenCalled()
  })
})

describe('deleteAttachment', () => {
  it('deletes only the row, scoped by workspace, and never touches Storage', async () => {
    queueTables({ data: [{ id: ROW.id }], error: null })
    await deleteAttachment(WS, { id: ROW.id })
    expect(log).toEqual(['attachments.delete'])
    expect(builders[0]?.callsOf('eq')).toEqual([
      ['workspace_id', WS],
      ['id', ROW.id],
    ])
    expect(builders[0]?.callsOf('select')).toEqual([['id']])
    expect(supabase.storage.from).not.toHaveBeenCalled()
  })

  it('reports forbidden for a zero-row delete with the uploader/owner/admin message', async () => {
    queueTables({ data: [], error: null })
    await expect(deleteAttachment(WS, ROW)).rejects.toMatchObject({
      name: 'AttachmentError',
      code: 'forbidden',
      message: expect.stringMatching(/uploader or an owner or admin/),
    })
  })

  it('maps a row error', async () => {
    queueTables({ data: null, error: { code: '42501', message: 'denied', details: null } })
    await expect(deleteAttachment(WS, ROW)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

function httpError(status: number, body: unknown) {
  return new FunctionsHttpError(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
}

describe('downloadAttachment', () => {
  const invoke = vi.mocked(supabase.functions.invoke)
  let clicks: { href: string; download: string }[]

  beforeEach(() => {
    clicks = []
    invoke.mockReset()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download })
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('asks attachment-url for a link and clicks a temporary anchor to it', async () => {
    const url = 'http://127.0.0.1:54321/storage/v1/object/sign/x?token=t'
    invoke.mockResolvedValue({
      data: { data: { url, expiresAt: '2026-11-04T10:01:00.000Z' } },
      error: null,
    } as never)
    const result = await downloadAttachment(ROW)
    expect(invoke).toHaveBeenCalledWith('attachment-url', { body: { attachmentId: ROW.id } })
    expect(result).toEqual({ url, expiresAt: '2026-11-04T10:01:00.000Z' })
    expect(clicks).toEqual([{ href: url, download: 'Resume.pdf' }])
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(supabase.storage.from).not.toHaveBeenCalled()
  })

  it.each([
    [401, { error: { code: 'unauthorized', message: 'x' } }, 'unauthorized'],
    [400, { error: { code: 'validation_error', message: 'x' } }, 'unknown'],
    [404, { error: { code: 'not_found', message: 'x' } }, 'not_found'],
    [500, { error: { code: 'internal', message: 'x' } }, 'unknown'],
    [401, 'Invalid JWT', 'unauthorized'],
    [404, 'not json', 'not_found'],
  ])('maps HTTP %i %j to %s and starts no download', async (status, body, code) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status, body) } as never)
    await expect(downloadAttachment(ROW)).rejects.toMatchObject({ name: 'AttachmentError', code })
    expect(clicks).toEqual([])
  })

  it('maps a failed fetch to network', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Failed to fetch')),
    } as never)
    await expect(downloadAttachment(ROW)).rejects.toMatchObject({ code: 'network' })
  })

  it('treats a body without a url as an unknown error', async () => {
    invoke.mockResolvedValue({ data: { data: {} }, error: null } as never)
    await expect(downloadAttachment(ROW)).rejects.toMatchObject({ code: 'unknown' })
    expect(clicks).toEqual([])
  })
})
