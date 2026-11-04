import { UploadIcon } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_TYPES_LABEL,
  MAX_ATTACHMENTS_PER_RECORD,
  describeAttachmentRuleError,
  validateFile,
} from '../lib/attachment-rules'

interface AttachmentDropzoneProps {
  /** Attachments the record already has. */
  existingCount: number
  /** An upload batch is running: no new files until it ends. */
  busy?: boolean
  /** Files that passed the local checks, in the order chosen. */
  onFiles: (files: File[]) => void
}

interface Rejection {
  name: string
  message: string
}

/**
 * "Choose files" button (the keyboard path) plus a drop target for the same
 * input. Files are checked with `validateFile` before anything is sent; each
 * rejected file gets its own inline message. Disabled at the per-record cap.
 */
export function AttachmentDropzone({
  existingCount,
  busy = false,
  onFiles,
}: AttachmentDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const errorsId = useId()
  const [dragging, setDragging] = useState(false)
  const [rejections, setRejections] = useState<Rejection[]>([])
  const full = existingCount >= MAX_ATTACHMENTS_PER_RECORD
  const disabled = full || busy

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    const accepted: File[] = []
    const rejected: Rejection[] = []
    for (const file of files) {
      const result = validateFile(file, existingCount + accepted.length)
      if (result.ok) accepted.push(file)
      else rejected.push({ name: file.name, message: describeAttachmentRuleError(result.error) })
    }
    setRejections(rejected)
    if (accepted.length > 0) onFiles(accepted)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    if (!disabled) setDragging(true)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (!disabled) handleFiles(event.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="attachment-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm',
          dragging && 'border-primary bg-primary/5',
          disabled && 'opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="attachment-input"
          disabled={disabled}
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-describedby={`${hintId} ${errorsId}`}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon aria-hidden="true" />
          {busy ? 'Uploading...' : 'Choose files'}
        </Button>
        <p id={hintId} className="text-muted-foreground text-xs">
          {full
            ? `This record has the maximum of ${MAX_ATTACHMENTS_PER_RECORD} attachments. Delete one to add another.`
            : `or drop files here. ${ALLOWED_TYPES_LABEL}, up to 10 MB each.`}
        </p>
      </div>
      <div id={errorsId} role="alert" aria-live="assertive">
        {rejections.length > 0 ? (
          <ul className="text-destructive flex flex-col gap-1 text-sm">
            {rejections.map((rejection, index) => (
              <li key={`${rejection.name}-${index}`}>
                <span className="font-medium break-all">{rejection.name}</span>: {rejection.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
