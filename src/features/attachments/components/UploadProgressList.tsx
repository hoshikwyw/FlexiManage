import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/format'

import type { UploadProgress } from '../types'

/**
 * Files of the running batch. Progress is indeterminate (supabase-js upload
 * reports no byte progress): a spinner while uploading, "Waiting" while
 * queued, "Uploaded" until the batch's list refresh lands, the error with a
 * dismiss button when a file failed.
 */
export function UploadProgressList({
  uploads,
  onDismiss,
}: {
  uploads: readonly UploadProgress[]
  onDismiss: (id: string) => void
}) {
  if (uploads.length === 0) return null
  return (
    <ul aria-label="Uploads" className="flex flex-col gap-2">
      {uploads.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
          aria-busy={item.status === 'uploading' || item.status === 'queued'}
        >
          {item.status === 'error' ? (
            <CircleAlertIcon
              className="text-destructive mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
          ) : item.status === 'done' ? (
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden="true" />
          ) : (
            <LoaderCircleIcon
              className="text-muted-foreground mt-0.5 size-4 shrink-0 motion-safe:animate-spin"
              aria-hidden="true"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium break-all">{item.name}</span>
            <span
              className={item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}
            >
              {item.status === 'error'
                ? item.error
                : item.status === 'uploading'
                  ? `Uploading ${formatBytes(item.sizeBytes)}...`
                  : item.status === 'done'
                    ? 'Uploaded'
                    : 'Waiting'}
            </span>
          </div>
          {item.status === 'error' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Dismiss ${item.name}`}
              onClick={() => onDismiss(item.id)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
