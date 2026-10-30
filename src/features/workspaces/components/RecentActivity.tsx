import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'

import { useAuditEvents } from '../api/use-audit-events'
import { describeAuditAction, describeAuditActor } from '../lib/audit-labels'

/** Dashboard card body: the latest audit events of one workspace. */
export function RecentActivity({ workspaceId }: { workspaceId: string }) {
  const events = useAuditEvents(workspaceId, 10)

  if (events.isPending) {
    return (
      <ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading activity">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-24" />
          </li>
        ))}
      </ul>
    )
  }

  if (events.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-destructive">Recent activity could not be loaded.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void events.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (events.data.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>
  }

  return (
    <ol className="flex flex-col gap-3" aria-label="Recent activity">
      {events.data.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 text-sm">
          <p>
            <span className="font-medium">{describeAuditActor(event)}</span>{' '}
            {describeAuditAction(event)}
          </p>
          <time dateTime={event.created_at} className="text-muted-foreground text-xs">
            {formatDateTime(event.created_at)}
          </time>
        </li>
      ))}
    </ol>
  )
}
