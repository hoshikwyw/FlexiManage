import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createTestQueryClient } from '@/test/render'

import { AttachmentError } from '../lib/storage-errors'
import type { AttachmentRow } from '../types'
import { uploadAttachment } from './attachment-writes'
import { useUploadAttachment } from './use-upload-attachment'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})
vi.mock('./attachment-writes', () => ({ uploadAttachment: vi.fn() }))

const WS = 'ws-1'
const RECORD = 'rec-1'

function setup() {
  const queryClient = createTestQueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useUploadAttachment(WS, RECORD), { wrapper })
  return { hook, invalidate }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const fileA = new File(['a'], 'a.png', { type: 'image/png' })
const fileB = new File(['bb'], 'b.pdf', { type: 'application/pdf' })

describe('useUploadAttachment', () => {
  it('uploads files one after another with a growing count and per-file states', async () => {
    const first = deferred<AttachmentRow>()
    const second = deferred<AttachmentRow>()
    vi.mocked(uploadAttachment)
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { hook, invalidate } = setup()

    let batch!: Promise<{ uploaded: number; failed: number }>
    act(() => {
      batch = hook.result.current.upload([fileA, fileB], 2)
    })

    await waitFor(() =>
      expect(hook.result.current.uploads.map((u) => [u.name, u.status])).toEqual([
        ['a.png', 'uploading'],
        ['b.pdf', 'queued'],
      ]),
    )
    expect(hook.result.current.isUploading).toBe(true)
    expect(uploadAttachment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(uploadAttachment).mock.calls[0]?.[0]).toMatchObject({
      workspaceId: WS,
      recordId: RECORD,
      file: fileA,
      existingCount: 2,
    })

    await act(async () => first.resolve({} as AttachmentRow))
    await waitFor(() =>
      expect(hook.result.current.uploads.map((u) => [u.name, u.status])).toEqual([
        ['a.png', 'done'],
        ['b.pdf', 'uploading'],
      ]),
    )
    expect(vi.mocked(uploadAttachment).mock.calls[1]?.[0]).toMatchObject({
      file: fileB,
      existingCount: 3,
    })
    // No list refetch between files: the batch invalidates once at the end.
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => second.resolve({} as AttachmentRow))
    await expect(batch).resolves.toEqual({ uploaded: 2, failed: 0 })
    await waitFor(() => expect(hook.result.current.isUploading).toBe(false))
    await waitFor(() => expect(hook.result.current.uploads).toEqual([]))
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attachments', WS, RECORD] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usage', WS] })
  })

  it('does not wait for the list refetch before uploading the next file', async () => {
    vi.mocked(uploadAttachment)
      .mockReset()
      .mockResolvedValueOnce({} as AttachmentRow)
      .mockResolvedValueOnce({} as AttachmentRow)
    const { hook, invalidate } = setup()
    // A refetch that never settles would stall a batch that awaited it.
    invalidate.mockImplementation(() => new Promise<void>(() => undefined))

    let result: { uploaded: number; failed: number } | undefined
    await act(async () => {
      result = await hook.result.current.upload([fileA, fileB], 0)
    })
    expect(result).toEqual({ uploaded: 2, failed: 0 })
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed file with its message, continues with the next and does not count it', async () => {
    vi.mocked(uploadAttachment)
      .mockReset()
      .mockRejectedValueOnce(new AttachmentError('type_not_allowed'))
      .mockResolvedValueOnce({} as AttachmentRow)
    const { hook } = setup()

    let result: { uploaded: number; failed: number } | undefined
    await act(async () => {
      result = await hook.result.current.upload([fileA, fileB], 0)
    })
    expect(result).toEqual({ uploaded: 1, failed: 1 })
    expect(vi.mocked(uploadAttachment).mock.calls[1]?.[0]).toMatchObject({ existingCount: 0 })
    const [failed] = hook.result.current.uploads
    expect(hook.result.current.uploads).toHaveLength(1)
    expect(failed).toMatchObject({ name: 'a.png', status: 'error' })
    expect(failed?.error).toMatch(/not allowed/)

    act(() => hook.result.current.dismiss(failed?.id ?? ''))
    expect(hook.result.current.uploads).toEqual([])
  })
})
