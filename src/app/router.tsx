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
import { AcceptInvitationPage } from '@/features/members/pages/AcceptInvitationPage'
import { MembersPage } from '@/features/members/pages/MembersPage'
import { ProfileSettingsPage } from '@/features/profile/pages/ProfileSettingsPage'
import { WorkspaceProvider } from '@/features/workspaces/context/WorkspaceProvider'
import { CreateWorkspacePage } from '@/features/workspaces/pages/CreateWorkspacePage'
import { RootRedirect } from '@/features/workspaces/pages/RootRedirect'
import { WorkspaceRoute } from '@/features/workspaces/pages/WorkspaceRoute'
import { WorkspaceSettingsPage } from '@/features/workspaces/pages/WorkspaceSettingsPage'

/**
 * Route map
 *
 *   /auth                      AuthLayout (centered card)
 *     sign-in, sign-up,        PublicOnlyRoute: signed-in users go to `redirectTo` or `/`
 *     forgot-password,
 *     verify-email
 *     reset-password           needs the session created by the recovery link
 *     callback                 exchanges the PKCE code from email links
 *   /                          ProtectedRoute -> WorkspaceProvider -> AppLayout (sidebar + header)
 *     (index)                  RootRedirect: /w/<current workspace> or /workspaces/new
 *     workspaces/new           CreateWorkspacePage (first run, or full-page create)
 *     w/:workspaceId           WorkspaceRoute: selects the workspace from the URL, 404 for non-members
 *       (index)                DashboardPage
 *       members                MembersPage
 *       settings               WorkspaceSettingsPage
 *     invite/:token            AcceptInvitationPage (sign-in redirect keeps the path)
 *     settings/profile         ProfileSettingsPage
 *     *                        NotFoundPage
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
        <WorkspaceProvider>
          <AppLayout />
        </WorkspaceProvider>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: 'workspaces/new', element: <CreateWorkspacePage /> },
      {
        path: 'w/:workspaceId',
        element: <WorkspaceRoute />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'settings', element: <WorkspaceSettingsPage /> },
        ],
      },
      { path: 'invite/:token', element: <AcceptInvitationPage /> },
      { path: 'settings/profile', element: <ProfileSettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
