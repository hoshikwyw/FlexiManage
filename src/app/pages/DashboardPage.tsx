import { useProfile } from '@/features/profile/api/use-profile'
import { getDisplayName } from '@/features/profile/lib/display-name'
import { useSession } from '@/features/auth/api/use-session'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function DashboardPage() {
  const { user } = useSession()
  const profile = useProfile()

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
        <p className="text-muted-foreground text-sm">
          This is your dashboard. Workspaces and their records will appear here.
        </p>
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
        {/* Part 6: workspaces, members. Replace with the workspace list and a create action. */}
        <Card>
          <CardHeader>
            <CardTitle>Your workspaces</CardTitle>
            <CardDescription>
              Create a workspace or switch between the ones you belong to.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Coming soon.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Audit events from your workspaces.</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Coming soon.</CardContent>
        </Card>
      </div>
    </div>
  )
}
