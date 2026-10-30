import { ChevronDownIcon, LogOutIcon, UserIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/features/auth/api/use-session'
import { useSignOut } from '@/features/auth/api/use-sign-out'
import { getAuthErrorMessage } from '@/features/auth/lib/auth-errors'
import { AUTH_ROUTES } from '@/features/auth/lib/auth-redirects'
import { useProfile } from '@/features/profile/api/use-profile'
import { getDisplayName, getInitials } from '@/features/profile/lib/display-name'

/** Header menu: avatar, name/email, profile link and sign out. */
export function UserMenu() {
  const { user } = useSession()
  const profile = useProfile()
  const signOut = useSignOut()
  const navigate = useNavigate()

  const email = profile.data?.email ?? user?.email ?? ''
  const displayName = getDisplayName(profile.data, user?.email)
  const avatarUrl = profile.data?.avatar_url ?? undefined

  async function handleSignOut() {
    try {
      await signOut.mutateAsync()
      toast.success('Signed out')
      navigate(AUTH_ROUTES.signIn, { replace: true })
    } catch (error) {
      toast.error(getAuthErrorMessage(error))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Account menu" />}
      >
        <Avatar size="sm">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
        </Avatar>
        {profile.isPending ? (
          <Skeleton className="hidden h-4 w-24 sm:block" />
        ) : (
          <span className="hidden max-w-40 truncate text-sm font-medium sm:block">
            {displayName}
          </span>
        )}
        <ChevronDownIcon className="text-muted-foreground size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-foreground text-sm font-medium">{displayName}</span>
            <span className="truncate font-normal">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/settings/profile" />}>
          <UserIcon aria-hidden="true" />
          Profile settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signOut.isPending}
          onClick={() => void handleSignOut()}
        >
          <LogOutIcon aria-hidden="true" />
          {signOut.isPending ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
