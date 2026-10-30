import { getRoleLabel } from '@/lib/workspace-roles'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/features/auth/api/use-session'
import { useProfile } from '@/features/profile/api/use-profile'
import { getDisplayName } from '@/features/profile/lib/display-name'
import { RecentActivity } from '@/features/workspaces/components/RecentActivity'
import { WorkspaceList } from '@/features/workspaces/components/WorkspaceList'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'

/** `/w/:workspaceId`: greeting, the user's workspaces and the current workspace's activity. */
export function DashboardPage() {
  const { user } = useSession()
  const profile = useProfile()
  const { workspace, role } = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {profile.isPending ? (
          <Skeleton className="h-8 w-64" aria-label="Loading your name" />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {getDisplayName(profile.data, user?.email)}
          </h1>
        )}
        {workspace && role ? (
          <p className="text-muted-foreground text-sm">
            You are {role === 'owner' || role === 'admin' ? 'an' : 'a'}{' '}
            {getRoleLabel(role).toLowerCase()} of{' '}
            <span className="font-medium">{workspace.name}</span>.
          </p>
        ) : null}
      </div>

      {profile.isError ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
        >
          <span>Your profile could not be loaded.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void profile.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your workspaces</CardTitle>
            <CardDescription>
              Switch between the workspaces you belong to or create one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceList />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              {workspace ? `Latest events in ${workspace.name}.` : 'Audit events of the workspace.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {workspace ? <RecentActivity workspaceId={workspace.id} /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
