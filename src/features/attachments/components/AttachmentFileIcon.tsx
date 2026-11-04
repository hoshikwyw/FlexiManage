import { createElement } from 'react'

import { cn } from '@/lib/utils'

import { getFileIcon } from '../lib/file-icons'

/** Decorative icon for a MIME type (the icons are module-level lucide components). */
export function AttachmentFileIcon({
  contentType,
  className,
}: {
  contentType: string
  className?: string
}) {
  return createElement(getFileIcon(contentType), {
    className: cn('text-muted-foreground size-5 shrink-0', className),
    'aria-hidden': true,
  })
}
