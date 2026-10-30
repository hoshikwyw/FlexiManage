import type { ReactNode } from 'react'
import { Navigate, Outlet, useSearchParams } from 'react-router-dom'

import { FullPageSpinner } from '@/components/shared/full-page-spinner'

import { useSession } from '../api/use-session'
import { REDIRECT_PARAM, getSafeRedirect } from '../lib/auth-redirects'

/**
 * The opposite of `ProtectedRoute`: signed-in users are sent away from the
 * sign-in / sign-up pages to `redirectTo` (validated) or the dashboard.
 */
export function PublicOnlyRoute({ children }: { children?: ReactNode }) {
  const { isLoading, isAuthenticated } = useSession()
  const [searchParams] = useSearchParams()

  if (isLoading) {
    return <FullPageSpinner label="Checking your session" />
  }

  if (isAuthenticated) {
    return <Navigate to={getSafeRedirect(searchParams.get(REDIRECT_PARAM))} replace />
  }

  return children ?? <Outlet />
}
