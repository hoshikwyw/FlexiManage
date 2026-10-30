import { useState } from 'react'
import { toast } from 'sonner'

import { RoleBadge } from '@/components/shared/role-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'

import { isInvitationExpired, useInvitations } from '../api/use-invitations'
import { useRevokeInvitation } from '../api/use-revoke-invitation'
import { getMemberErrorMessage } from '../lib/member-errors'

/** Pending invitations of a workspace with a Revoke action (owner/admin only; RLS hides them otherwise). */
export function PendingInvitations({ workspaceId }: { workspaceId: string }) {
  const invitations = useInvitations(workspaceId)
  const revoke = useRevokeInvitation(workspaceId)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  async function handleRevoke(id: string, email: string) {
    setRevokingId(id)
    try {
      await revoke.mutateAsync(id)
      toast.success(`Invitation for ${email} revoked`)
    } catch (error) {
      toast.error(getMemberErrorMessage(error))
    } finally {
      setRevokingId(null)
    }
  }

  if (invitations.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading invitations">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
    )
  }

  if (invitations.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-destructive">Invitations could not be loaded.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void invitations.refetch()}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (invitations.data.length === 0) {
    return <p className="text-muted-foreground text-sm">No pending invitations.</p>
  }

  return (
    <ul className="divide-border flex flex-col divide-y" aria-label="Pending invitations">
      {invitations.data.map((invitation) => {
        const expired = isInvitationExpired(invitation)
        return (
          <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{invitation.email}</span>
              <span className="text-muted-foreground text-xs">
                {expired ? 'Expired ' : 'Expires '}
                <time dateTime={invitation.expires_at}>{formatDate(invitation.expires_at)}</time>
              </span>
            </div>
            {expired ? <Badge variant="destructive">Expired</Badge> : null}
            <RoleBadge role={invitation.role} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={revokingId === invitation.id}
              aria-label={`Revoke invitation for ${invitation.email}`}
              onClick={() => void handleRevoke(invitation.id, invitation.email)}
            >
              {revokingId === invitation.id ? 'Revoking...' : 'Revoke'}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
