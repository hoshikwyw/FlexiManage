import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { FullPageSpinner } from '@/components/shared/full-page-spinner'

import { useSession } from '../api/use-session'
import { buildSignInUrl } from '../lib/auth-redirects'

/**
 * Renders its children (or the nested `<Outlet />`) only for signed-in users.
 * Unauthenticated users go to `/auth/sign-in?redirectTo=<current path>`.
 * While the first auth state is unknown it shows a spinner, never the sign-in page.
 */
export function ProtectedRoute({ children }: { children?: ReactNode }) {
  const { isLoading, isAuthenticated } = useSession()
  const location = useLocation()

  if (isLoading) {
    return <FullPageSpinner label="Checking your session" />
  }

  if (!isAuthenticated) {
    const redirectTo = `${location.pathname}${location.search}`
    return <Navigate to={buildSignInUrl(redirectTo)} replace />
  }

  return children ?? <Outlet />
}
