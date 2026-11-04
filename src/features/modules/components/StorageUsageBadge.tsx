import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/format'

import { useWorkspaceUsage } from '../api/use-workspace-usage'

/**
 * "12.3 MB used": attachment storage of the workspace from
 * `workspace_usage().storage_bytes`. Phase 4 appends the plan limit ("of 50
 * MB"). Like ModuleUsageBadge it renders nothing on error.
 */
export function StorageUsageBadge({ workspaceId }: { workspaceId: string }) {
  const usage = useWorkspaceUsage(workspaceId)
  if (usage.isPending) return <Skeleton className="h-5 w-20" aria-label="Loading storage used" />
  if (usage.isError) return null
  return (
    <Badge variant="outline" aria-live="polite" title="Storage used by attachments">
      {formatBytes(usage.data.storage_bytes)} used
    </Badge>
  )
}
