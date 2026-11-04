import { PaperclipIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { WorkspaceRole } from '@/types/database'

import { useAttachments } from '../api/use-attachments'
import { useDownloadAttachment } from '../api/use-download-attachment'
import { useUploadAttachment } from '../api/use-upload-attachment'
import { canDeleteAttachment } from '../lib/attachment-permissions'
import { MAX_ATTACHMENTS_PER_RECORD } from '../lib/attachment-rules'
import { getAttachmentErrorMessage } from '../lib/storage-errors'
import type { AttachmentItem } from '../types'
import { AttachmentDropzone } from './AttachmentDropzone'
import { AttachmentList, AttachmentListSkeleton } from './AttachmentList'
import { DeleteAttachmentDialog } from './DeleteAttachmentDialog'
import { UploadProgressList } from './UploadProgressList'

interface AttachmentsSectionProps {
  workspaceId: string
  recordId: string
  currentUserId: string | null
  role: WorkspaceRole | null
}

/**
 * Files of a record (story B4): list with download and delete, upload by
 * button or drag and drop, "n of 10". Any member uploads and downloads; the
 * delete action is shown to the uploader and to owners and admins, and the
 * server's policies decide either way.
 */
export function AttachmentsSection({
  workspaceId,
  recordId,
  currentUserId,
  role,
}: AttachmentsSectionProps) {
  const attachments = useAttachments(workspaceId, recordId)
  const uploader = useUploadAttachment(workspaceId, recordId)
  const download = useDownloadAttachment()
  const [deleting, setDeleting] = useState<AttachmentItem | null>(null)
  const [status, setStatus] = useState('')
  const count = attachments.data?.length ?? 0

  async function handleFiles(files: File[]) {
    setStatus(`Uploading ${files.length === 1 ? files[0]?.name : `${files.length} files`}...`)
    const result = await uploader.upload(files, count)
    setStatus(
      result.failed === 0
        ? `${result.uploaded === 1 ? '1 file' : `${result.uploaded} files`} uploaded.`
        : `${result.uploaded} uploaded, ${result.failed} failed.`,
    )
  }

  function handleDownload(attachment: AttachmentItem) {
    download.mutate(attachment, {
      onError: (error) => toast.error(getAttachmentErrorMessage(error)),
    })
  }

  return (
    <section aria-labelledby="record-attachments" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="record-attachments" className="flex items-center gap-2 text-lg font-semibold">
          <PaperclipIcon className="size-4" aria-hidden="true" />
          Attachments
        </h2>
        {attachments.isSuccess ? (
          <p className="text-muted-foreground text-sm" data-testid="attachment-count">
            {count} of {MAX_ATTACHMENTS_PER_RECORD}
          </p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {attachments.isPending ? (
        <AttachmentListSkeleton />
      ) : attachments.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4 text-sm">
          <p className="text-destructive">Attachments could not be loaded.</p>
          <Button type="button" variant="outline" onClick={() => void attachments.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {attachments.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">No files attached yet.</p>
          ) : (
            <AttachmentList
              attachments={attachments.data}
              currentUserId={currentUserId}
              canDelete={(attachment) => canDeleteAttachment(attachment, currentUserId, role)}
              onDownload={handleDownload}
              onDelete={setDeleting}
              downloadingId={download.isPending ? download.variables.id : null}
            />
          )}
          <UploadProgressList uploads={uploader.uploads} onDismiss={uploader.dismiss} />
          <AttachmentDropzone
            existingCount={count}
            busy={uploader.isUploading}
            onFiles={(files) => void handleFiles(files)}
          />
        </>
      )}

      <DeleteAttachmentDialog
        workspaceId={workspaceId}
        recordId={recordId}
        attachment={deleting}
        onClose={() => setDeleting(null)}
      />
    </section>
  )
}
