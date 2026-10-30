import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useProfile } from '../api/use-profile'
import { ProfileForm } from '../components/ProfileForm'

export function ProfileSettingsPage() {
  const profile = useProfile()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground text-sm">Manage how you appear across FlexiManage.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>Your name and sign-in email.</CardDescription>
        </CardHeader>
        <CardContent>
          {profile.isPending ? (
            <ProfileFormSkeleton />
          ) : profile.isError ? (
            <div role="alert" className="flex flex-col items-start gap-3 text-sm">
              <p className="text-destructive">Your profile could not be loaded.</p>
              <Button type="button" variant="outline" onClick={() => void profile.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <ProfileForm key={profile.data.updated_at} profile={profile.data} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProfileFormSkeleton() {
  return (
    <div className="flex max-w-md flex-col gap-5" aria-busy="true" aria-label="Loading profile">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-full" />
      </div>
      <Skeleton className="h-8 w-28" />
    </div>
  )
}
