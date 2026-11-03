import { FileSearchIcon, InboxIcon, PlusIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** Placeholder rows while the first page loads. */
export function RecordsTableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="rounded-lg border p-3" aria-busy="true" aria-label="Loading records">
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="flex gap-3">
            {Array.from({ length: Math.min(columns, 6) }, (_, cell) => (
              <Skeleton key={cell} className="h-5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function RecordsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6 text-sm">
      <p className="text-destructive">Records could not be loaded.</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/** The module has no records at all. */
export function RecordsEmpty({ createHref }: { createHref?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <InboxIcon className="text-muted-foreground size-8" aria-hidden="true" />
      <h2 className="text-lg font-semibold tracking-tight">No records yet</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        Records are the rows of this module. Create the first one to get started.
      </p>
      {createHref ? (
        <Link to={createHref} className={buttonVariants()}>
          <PlusIcon aria-hidden="true" />
          New record
        </Link>
      ) : null}
    </div>
  )
}

/** Search or filters are active and nothing matches. */
export function RecordsNoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <FileSearchIcon className="text-muted-foreground size-8" aria-hidden="true" />
      <h2 className="text-lg font-semibold tracking-tight">No records match</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        No record matches the current search and filters.
      </p>
      <Button type="button" variant="outline" onClick={onClear}>
        Clear search and filters
      </Button>
    </div>
  )
}
