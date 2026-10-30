import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/features/auth/api/use-session'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'

import { useMembers } from '../api/use-members'
import { InviteMemberForm } from '../components/InviteMemberForm'
import { MembersTable, MembersTableSkeleton } from '../components/MembersTable'
import { PendingInvitations } from '../components/PendingInvitations'
import { canInvite, canManageInvitations } from '../lib/member-permissions'

/** `/w/:workspaceId/members`: members table, invite form and pending invitations. */
export function MembersPage() {
  const { workspace, role } = useCurrentWorkspace()
  const { user } = useSession()
  const members = useMembers(workspace?.id)

  if (!workspace) return null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground text-sm">People with access to {workspace.name}.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members{members.data ? ` (${members.data.length})` : ''}</CardTitle>
          <CardDescription>
            Owners manage roles; owners and admins invite and remove.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.isPending ? (
            <MembersTableSkeleton />
          ) : members.isError ? (
            <div role="alert" className="flex flex-col items-start gap-3 text-sm">
              <p className="text-destructive">Members could not be loaded.</p>
              <Button type="button" variant="outline" onClick={() => void members.refetch()}>
                Try again
              </Button>
            </div>
          ) : members.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">No members yet.</p>
          ) : (
            <MembersTable
              workspaceId={workspace.id}
              members={members.data}
              callerRole={role}
              callerUserId={user?.id}
            />
          )}
        </CardContent>
      </Card>

      {role && canInvite(role) ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>
              {role === 'owner'
                ? 'Invite as owner, admin or member.'
                : 'Invite as admin or member. Only owners can grant the owner role.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteMemberForm workspaceId={workspace.id} callerRole={role} />
          </CardContent>
        </Card>
      ) : null}

      {canManageInvitations(role) ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Revoking an invitation makes its link unusable.</CardDescription>
          </CardHeader>
          <CardContent>
            <PendingInvitations workspaceId={workspace.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
