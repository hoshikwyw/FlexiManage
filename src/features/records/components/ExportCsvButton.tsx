import { DownloadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { WorkspaceRole } from '@/types/database'

import { useExportRecords } from '../api/use-export-records'
import { ExportError, canExportRecords, describeExportError } from '../lib/export-records'
import type { RecordsQuery } from '../types'

interface ExportCsvButtonProps {
  workspaceId: string
  moduleId: string
  moduleSlug: string
  role: WorkspaceRole | null | undefined
  query: Pick<RecordsQuery, 'search' | 'filters'>
  /** Nothing to export: the table shows zero rows (or is still loading). */
  disabled?: boolean
}

/**
 * "Export CSV" for owners and admins (story B5): the rows matching the
 * current search and filters. Members never see it; the function answers
 * them 403 anyway. Results are announced through toasts (a live region).
 */
export function ExportCsvButton({
  workspaceId,
  moduleId,
  moduleSlug,
  role,
  query,
  disabled = false,
}: ExportCsvButtonProps) {
  const exportRecords = useExportRecords()
  if (!canExportRecords(role)) return null

  function handleClick() {
    exportRecords.mutate(
      { workspaceId, moduleId, moduleSlug, query },
      {
        onSuccess: () => toast.success('Export downloaded'),
        onError: (error) =>
          toast.error(
            error instanceof ExportError ? error.message : describeExportError('internal'),
          ),
      },
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || exportRecords.isPending}
      aria-busy={exportRecords.isPending}
      onClick={handleClick}
    >
      <DownloadIcon aria-hidden="true" />
      {exportRecords.isPending ? 'Exporting...' : 'Export CSV'}
    </Button>
  )
}
