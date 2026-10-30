import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/app/layouts/AppLayout'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import { DashboardPage } from '@/app/pages/DashboardPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { RouteErrorBoundary } from '@/components/shared/route-error-boundary'
import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute'
import { PublicOnlyRoute } from '@/features/auth/components/PublicOnlyRoute'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage'
import { SignInPage } from '@/features/auth/pages/SignInPage'
import { SignUpPage } from '@/features/auth/pages/SignUpPage'
import { VerifyEmailPage } from '@/features/auth/pages/VerifyEmailPage'
import { ProfileSettingsPage } from '@/features/profile/pages/ProfileSettingsPage'

/**
 * Route map
 *
 *   /auth                      AuthLayout (centered card)
 *     sign-in, sign-up,        PublicOnlyRoute: signed-in users go to `redirectTo` or `/`
 *     forgot-password,
 *     verify-email
 *     reset-password           needs the session created by the recovery link
 *     callback                 exchanges the PKCE code from email links
 *   /                          ProtectedRoute -> AppLayout (sidebar + header)
 *     (index)                  DashboardPage
 *     settings/profile         ProfileSettingsPage
 *     // Part 6: workspaces, members
 *   *                          NotFoundPage
 */
export const router = createBrowserRouter([
  {
    path: '/auth',
    element: <AuthLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <PublicOnlyRoute />,
        children: [
          { path: 'sign-in', element: <SignInPage /> },
          { path: 'sign-up', element: <SignUpPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
          { path: 'verify-email', element: <VerifyEmailPage /> },
        ],
      },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'callback', element: <AuthCallbackPage /> },
    ],
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'settings/profile', element: <ProfileSettingsPage /> },
      // Part 6: workspaces, members
      // { path: 'workspaces/new', element: <CreateWorkspacePage /> },
      // { path: 'workspaces/:slug', element: <WorkspaceLayout />, children: [
      //   { path: 'members', element: <MembersPage /> },
      // ] },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
