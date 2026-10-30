import { LogOutIcon, MoreHorizontalIcon, ShieldIcon, UserMinusIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { getRoleLabel } from '@/lib/workspace-roles'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'
import { WORKSPACE_ROLES, type WorkspaceRole } from '@/types/database'

import { useChangeMemberRole } from '../api/use-change-member-role'
import { useRemoveMember } from '../api/use-remove-member'
import { getMemberErrorMessage } from '../lib/member-errors'
import { canChangeRole, canRemoveMember } from '../lib/member-permissions'
import type { Member } from '../types'

interface MemberActionsMenuProps {
  workspaceId: string
  member: Member
  memberName: string
  callerRole: WorkspaceRole | null
  isSelf: boolean
}

/**
 * Per-row actions: change role (owner), remove (owner, or admin for
 * non-owners) and leave (self). Renders nothing when the caller may do none of
 * these. Destructive actions confirm first; the server stays the authority.
 */
export function MemberActionsMenu({
  workspaceId,
  member,
  memberName,
  callerRole,
  isSelf,
}: MemberActionsMenuProps) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const changeRole = useChangeMemberRole(workspaceId)
  const removeMember = useRemoveMember(workspaceId)
  const navigate = useNavigate()

  const showRoles = canChangeRole(callerRole, { isSelf })
  const showRemove = canRemoveMember(callerRole, member.role, { isSelf })
  if (!showRoles && !showRemove) return null

  async function handleChangeRole(role: WorkspaceRole) {
    try {
      await changeRole.mutateAsync({ userId: member.user_id, role })
      toast.success(`${memberName} is now ${getRoleLabel(role).toLowerCase()}`)
    } catch (error) {
      toast.error(getMemberErrorMessage(error))
    }
  }

  async function handleRemove() {
    try {
      await removeMember.mutateAsync(member.user_id)
      setConfirmRemove(false)
      if (isSelf) {
        toast.success('You left the workspace')
        navigate(WORKSPACE_ROUTES.root, { replace: true })
      } else {
        toast.success(`${memberName} was removed`)
      }
    } catch (error) {
      toast.error(getMemberErrorMessage(error))
    }
  }

  const busy = changeRole.isPending || removeMember.isPending

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${memberName}`}
              disabled={busy}
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {showRoles ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Change role</DropdownMenuLabel>
              {WORKSPACE_ROLES.filter((role) => role !== member.role).map((role) => (
                <DropdownMenuItem key={role} onClick={() => void handleChangeRole(role)}>
                  <ShieldIcon aria-hidden="true" />
                  Make {getRoleLabel(role).toLowerCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {showRoles && showRemove ? <DropdownMenuSeparator /> : null}
          {showRemove ? (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmRemove(true)}>
              {isSelf ? (
                <>
                  <LogOutIcon aria-hidden="true" />
                  Leave workspace
                </>
              ) : (
                <>
                  <UserMinusIcon aria-hidden="true" />
                  Remove from workspace
                </>
              )}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isSelf ? 'Leave this workspace?' : `Remove ${memberName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isSelf
                ? 'You lose access immediately. An owner or admin can invite you again.'
                : 'They lose access immediately. You can invite them again later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMember.isPending}
              onClick={() => void handleRemove()}
            >
              {removeMember.isPending ? 'Working...' : isSelf ? 'Leave workspace' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
