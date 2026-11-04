import { useMutation } from '@tanstack/react-query'

import type { AttachmentRow } from '../types'
import { downloadAttachment } from './attachment-writes'

/** Creates a 60-second signed URL and starts the browser download. */
export function useDownloadAttachment() {
  return useMutation({
    mutationFn: (attachment: Pick<AttachmentRow, 'id' | 'storage_path' | 'file_name'>) =>
      downloadAttachment(attachment),
  })
}
