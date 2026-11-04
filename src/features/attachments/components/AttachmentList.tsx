import { DownloadIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes, formatDateTime } from '@/lib/format'

import { uploaderName } from '../lib/uploader-name'
import type { AttachmentItem } from '../types'
import { AttachmentFileIcon } from './AttachmentFileIcon'

interface AttachmentListProps {
  attachments: readonly AttachmentItem[]
  currentUserId: string | null
  /** Whether the delete action is offered for this attachment (the server decides). */
  canDelete: (attachment: AttachmentItem) => boolean
  onDownload: (attachment: AttachmentItem) => void
  onDelete: (attachment: AttachmentItem) => void
  /** Id of the attachment whose download link is being created. */
  downloadingId?: string | null
}

/** One row per file: icon, name, size, uploader, date, download and (when allowed) delete. */
export function AttachmentList({
  attachments,
  currentUserId,
  canDelete,
  onDownload,
  onDelete,
  downloadingId,
}: AttachmentListProps) {
  return (
    <ul aria-label="Attached files" className="divide-y rounded-lg border">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
          <AttachmentFileIcon contentType={attachment.content_type} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium break-all">{attachment.file_name}</span>
            <span className="text-muted-foreground text-xs">
              {formatBytes(attachment.size_bytes)} · Uploaded by{' '}
              {uploaderName(attachment, currentUserId)} on {formatDateTime(attachment.created_at)}
            </span>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Download ${attachment.file_name}`}
              disabled={downloadingId === attachment.id}
              onClick={() => onDownload(attachment)}
            >
              <DownloadIcon aria-hidden="true" />
              Download
            </Button>
            {canDelete(attachment) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete ${attachment.file_name}`}
                onClick={() => onDelete(attachment)}
              >
                <Trash2Icon aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function AttachmentListSkeleton() {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-3"
      aria-busy="true"
      aria-label="Loading attachments"
    >
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-5" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
