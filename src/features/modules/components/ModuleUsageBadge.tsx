import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

import { useWorkspaceUsage } from '../api/use-workspace-usage'

/**
 * "N modules" from `workspace_usage()`. Phase 4 appends the plan limit here
 * ("1 of 5 modules"); until then it is the live count. Quietly renders nothing
 * on error: the list itself is the source of truth for the user.
 */
export function ModuleUsageBadge({ workspaceId }: { workspaceId: string }) {
  const usage = useWorkspaceUsage(workspaceId)
  if (usage.isPending) return <Skeleton className="h-5 w-20" aria-label="Loading module count" />
  if (usage.isError) return null
  const count = usage.data.modules
  return (
    <Badge variant="secondary" aria-live="polite">
      {count} {count === 1 ? 'module' : 'modules'}
    </Badge>
  )
}
