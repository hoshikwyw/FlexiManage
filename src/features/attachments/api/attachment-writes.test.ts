import { StorageApiError, StorageUnknownError } from '@supabase/storage-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { createQueryBuilderMock, type QueryBuilderMock } from '@/test/query-builder-mock'
import { createStorageBucketMock, type StorageBucketMock } from '@/test/supabase-mock'

import { AttachmentError } from '../lib/storage-errors'
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
  bucket.remove.mockImplementation(async () => {
    log.push('storage.remove')
    return { data: [{ name: ROW.storage_path }], error: null }
  })
  vi.mocked(supabase.storage.from).mockReturnValue(bucket as never)
})

afterEach(() => {
  vi.mocked(supabase.from).mockReset()
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
  it('removes the storage object first, then the row, scoped by workspace', async () => {
    queueTables({ data: [{ id: ROW.id }], error: null })
    await deleteAttachment(WS, ROW)
    expect(log).toEqual(['storage.remove', 'attachments.delete'])
    expect(bucket.remove).toHaveBeenCalledWith([ROW.storage_path])
    expect(builders[0]?.callsOf('eq')).toEqual([
      ['workspace_id', WS],
      ['id', ROW.id],
    ])
    expect(builders[0]?.callsOf('select')).toEqual([['id']])
  })

  it('throws forbidden when the row delete affects zero rows', async () => {
    bucket.remove.mockImplementation(async () => {
      log.push('storage.remove')
      return { data: [], error: null }
    })
    queueTables({ data: [], error: null })
    await expect(deleteAttachment(WS, ROW)).rejects.toBeInstanceOf(AttachmentError)
    expect(log).toEqual(['storage.remove', 'attachments.delete'])
  })

  it('reports forbidden for a zero-row delete with the uploader/owner/admin message', async () => {
    queueTables({ data: [], error: null })
    await expect(deleteAttachment(WS, ROW)).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringMatching(/uploader or an owner or admin/),
    })
  })

  it('stops before the row delete when Storage fails', async () => {
    queueTables()
    bucket.remove.mockResolvedValue({ data: null, error: new StorageApiError('x', 400, '403') })
    await expect(deleteAttachment(WS, ROW)).rejects.toMatchObject({ code: 'forbidden' })
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('downloadAttachment', () => {
  it('creates a 60-second signed URL with the original name and clicks a download anchor', async () => {
    bucket.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/x?token=t' },
      error: null,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      log.push(`click ${this.download} ${this.href}`)
    })
    await downloadAttachment(ROW)
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(ROW.storage_path, 60, {
      download: 'Resume.pdf',
    })
    expect(log).toEqual([
      'click Resume.pdf http://127.0.0.1:54321/storage/v1/object/sign/x?token=t',
    ])
    expect(document.querySelectorAll('a')).toHaveLength(0)
    click.mockRestore()
  })

  it('maps a not-found answer and starts no download', async () => {
    bucket.createSignedUrl.mockResolvedValue({
      data: null,
      error: new StorageApiError('Object not found', 400, '404'),
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    await expect(downloadAttachment(ROW)).rejects.toMatchObject({ code: 'not_found' })
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })
})
