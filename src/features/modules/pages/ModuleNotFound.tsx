import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

/** Generic 404 for a module id RLS hides or that does not exist (never reveals which). */
export function ModuleNotFound({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Module not found</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        This module does not exist in the current workspace or was deleted.
      </p>
      <Link to={WORKSPACE_ROUTES.modules(workspaceId)} className={buttonVariants()}>
        Back to modules
      </Link>
    </div>
  )
}
