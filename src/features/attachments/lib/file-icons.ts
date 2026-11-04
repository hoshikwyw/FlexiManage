import {
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PresentationIcon,
  type LucideIcon,
} from 'lucide-react'

/** Icon per MIME type family; anything unknown gets the plain file icon. */
export function getFileIcon(contentType: string): LucideIcon {
  if (contentType.startsWith('image/')) return FileImageIcon
  if (contentType === 'text/csv' || contentType.endsWith('spreadsheetml.sheet')) {
    return FileSpreadsheetIcon
  }
  if (contentType.endsWith('presentationml.presentation')) return PresentationIcon
  if (contentType === 'application/zip') return FileArchiveIcon
  if (
    contentType === 'application/pdf' ||
    contentType === 'text/plain' ||
    contentType.endsWith('wordprocessingml.document')
  ) {
    return FileTextIcon
  }
  return FileIcon
}
