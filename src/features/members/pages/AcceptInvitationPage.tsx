import { Loader2Icon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { useAcceptInvitation } from '../api/use-accept-invitation'
import { MemberActionError, getMemberErrorMessage } from '../lib/member-errors'

/**
 * `/invite/:token` (protected; the sign-in redirect keeps the path). Accepts
 * the invitation once, makes the workspace current and lands on its dashboard.
 */
export function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const accept = useAcceptInvitation(token)
  const { setWorkspaceId } = useCurrentWorkspace()
  const navigate = useNavigate()
  const handled = useRef(false)

  useEffect(() => {
    if (!accept.data || handled.current) return
    handled.current = true
    setWorkspaceId(accept.data.workspaceId)
    toast.success(`Joined ${accept.data.workspaceName}`)
    navigate(WORKSPACE_ROUTES.dashboard(accept.data.workspaceId), { replace: true })
  }, [accept.data, navigate, setWorkspaceId])

  const { title, description } = describe(accept.error, token)

  return (
    <div className="mx-auto w-full max-w-md">
      <Card role={accept.error ? 'alert' : undefined} aria-live="polite">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {accept.isPending && token ? (
          <CardContent className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Accepting your invitation...
          </CardContent>
        ) : null}
        {accept.error || !token ? (
          <CardFooter>
            <Link to={WORKSPACE_ROUTES.root} className={buttonVariants()}>
              Go to my workspaces
            </Link>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  )
}

function describe(
  error: unknown,
  token: string | undefined,
): { title: string; description: string } {
  if (!token) {
    return {
      title: 'Invitation link incomplete',
      description: 'Open the link from your email again.',
    }
  }
  if (!error) {
    return { title: 'Joining workspace', description: 'One moment while we add you to the team.' }
  }
  if (error instanceof MemberActionError) {
    switch (error.code) {
      case 'not_found':
        return {
          title: 'This invitation is no longer valid',
          description: 'It was already used or revoked. Ask an owner or admin for a new one.',
        }
      case 'invitation_expired':
        return {
          title: 'This invitation has expired',
          description: 'Invitations are valid for 7 days. Ask an owner or admin for a new one.',
        }
      case 'forbidden':
        return {
          title: 'This invitation was sent to a different email address',
          description:
            'Sign in with the account that received the invitation and open the link again.',
        }
      case 'unauthorized':
        return {
          title: 'Please sign in again',
          description: getMemberErrorMessage(error),
        }
      default:
        break
    }
  }
  return {
    title: 'The invitation could not be accepted',
    description: getMemberErrorMessage(error),
  }
}
