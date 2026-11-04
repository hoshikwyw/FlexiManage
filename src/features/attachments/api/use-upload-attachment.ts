import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { getAttachmentErrorMessage } from '../lib/storage-errors'
import type { UploadProgress } from '../types'
import { uploadAttachment } from './attachment-writes'
import { invalidateAttachments } from './invalidate'

export interface UploadBatchResult {
  uploaded: number
  failed: number
}

/**
 * Uploads files one after another (`uploadAttachment`: validate, insert row,
 * upload, roll back on failure) and keeps a per-file progress list for the UI.
 * supabase-js `upload` reports no byte progress, so a file is `queued`, then
 * `uploading` (indeterminate), then leaves the list once it is uploaded (the
 * refreshed attachments list shows it), or stays as `error` with a message
 * until dismissed or the next batch starts. The progress list is local UI
 * state; the attachments themselves are server state in TanStack Query.
 */
export function useUploadAttachment(workspaceId: string, recordId: string) {
  const queryClient = useQueryClient()
  const [uploads, setUploads] = useState<UploadProgress[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const nextId = useRef(0)

  const { mutateAsync } = useMutation({
    mutationFn: uploadAttachment,
    onSuccess: () => invalidateAttachments(queryClient, workspaceId, recordId),
  })

  const patch = useCallback((id: string, changes: Partial<UploadProgress>) => {
    setUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    )
  }, [])

  const upload = useCallback(
    async (files: readonly File[], existingCount: number): Promise<UploadBatchResult> => {
      const items: UploadProgress[] = files.map((file) => {
        nextId.current += 1
        return {
          id: `upload-${nextId.current}`,
          name: file.name,
          sizeBytes: file.size,
          status: 'queued',
        }
      })
      setUploads((current) => [...current.filter((item) => item.status !== 'error'), ...items])
      setIsUploading(true)

      let count = existingCount
      let uploaded = 0
      try {
        for (const [index, file] of files.entries()) {
          const item = items[index]
          if (!item) continue
          patch(item.id, { status: 'uploading' })
          try {
            await mutateAsync({ workspaceId, recordId, file, existingCount: count })
            count += 1
            uploaded += 1
            setUploads((current) => current.filter((entry) => entry.id !== item.id))
          } catch (error) {
            patch(item.id, { status: 'error', error: getAttachmentErrorMessage(error) })
          }
        }
      } finally {
        setIsUploading(false)
      }
      return { uploaded, failed: files.length - uploaded }
    },
    [mutateAsync, patch, recordId, workspaceId],
  )

  const dismiss = useCallback((id: string) => {
    setUploads((current) => current.filter((item) => item.id !== id))
  }, [])

  return { upload, uploads, isUploading, dismiss }
}
