import { TriangleAlertIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import {
  RECORD_CONFLICT_MESSAGE,
  RECORD_RELOAD_FAILED_MESSAGE,
  RECORD_RELOADED_MESSAGE,
} from '../lib/record-conflict'
import type { ConflictState } from '../hooks/use-record-conflict'

interface RecordConflictBannerProps {
  state: ConflictState
  onReload: () => void
}

/**
 * Non-destructive notice for a `PT409` save: nothing in the form is lost;
 * "Reload" loads the latest version and keeps the user's edits. The alert
 * region is always rendered so screen readers announce the change; the
 * "reloaded" confirmation is polite.
 */
export function RecordConflictBanner({ state, onReload }: RecordConflictBannerProps) {
  const open = state === 'conflict' || state === 'reloading' || state === 'reload-failed'
  return (
    <>
      <div role="alert" aria-live="assertive">
        {open ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-start dark:bg-amber-950/30 dark:text-amber-100">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="flex flex-1 flex-col gap-1">
              <p>{RECORD_CONFLICT_MESSAGE}</p>
              {state === 'reload-failed' ? <p>{RECORD_RELOAD_FAILED_MESSAGE}</p> : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReload}
              disabled={state === 'reloading'}
            >
              {state === 'reloading' ? 'Reloading...' : 'Reload'}
            </Button>
          </div>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="text-muted-foreground text-sm empty:hidden">
        {state === 'reloaded' ? RECORD_RELOADED_MESSAGE : ''}
      </p>
    </>
  )
}
