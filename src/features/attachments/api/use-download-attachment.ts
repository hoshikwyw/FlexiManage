import { useMutation } from '@tanstack/react-query'

import type { AttachmentRow } from '../types'
import { downloadAttachment } from './attachment-writes'

/** Asks `attachment-url` for a short-lived link and starts the browser download. */
export function useDownloadAttachment() {
  return useMutation({
    mutationFn: (attachment: Pick<AttachmentRow, 'id' | 'file_name'>) =>
      downloadAttachment(attachment),
  })
}
