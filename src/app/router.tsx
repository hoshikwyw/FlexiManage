import { Suspense, lazy, type ComponentType } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/app/layouts/AppLayout'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import { FullPageSpinner } from '@/components/shared/full-page-spinner'
import { RouteErrorBoundary } from '@/components/shared/route-error-boundary'
import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute'
import { PublicOnlyRoute } from '@/features/auth/components/PublicOnlyRoute'
import { WorkspaceProvider } from '@/features/workspaces/context/WorkspaceProvider'
import { RootRedirect } from '@/features/workspaces/pages/RootRedirect'
import { WorkspaceRoute } from '@/features/workspaces/pages/WorkspaceRoute'

/**
 * Code-splits a page by its named export and wraps it in a Suspense boundary,
 * so each page module (and whatever only it imports) becomes its own chunk.
 * Layouts, guards and the workspace provider stay in the main bundle.
 */
function lazyPage<K extends string>(load: () => Promise<{ [P in K]: ComponentType }>, name: K) {
  const Page = lazy<ComponentType>(async () => ({ default: (await load())[name] }))
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Page />
    </Suspense>
  )
}

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
 *       modules                ModulesPage (list, create dialog with templates)
 *       modules/:moduleId      ModulePage (tabs: Records table, Fields)
 *       modules/:moduleId/settings  ModuleSettingsPage (form, danger zone)
 *       modules/:moduleId/records/new        NewRecordPage
 *       modules/:moduleId/records/:recordId  RecordPage (read; ?edit=1 edits)
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
          {
            path: 'sign-in',
            element: lazyPage(() => import('@/features/auth/pages/SignInPage'), 'SignInPage'),
          },
          {
            path: 'sign-up',
            element: lazyPage(() => import('@/features/auth/pages/SignUpPage'), 'SignUpPage'),
          },
          {
            path: 'forgot-password',
            element: lazyPage(
              () => import('@/features/auth/pages/ForgotPasswordPage'),
              'ForgotPasswordPage',
            ),
          },
          {
            path: 'verify-email',
            element: lazyPage(
              () => import('@/features/auth/pages/VerifyEmailPage'),
              'VerifyEmailPage',
            ),
          },
        ],
      },
      {
        path: 'reset-password',
        element: lazyPage(
          () => import('@/features/auth/pages/ResetPasswordPage'),
          'ResetPasswordPage',
        ),
      },
      {
        path: 'callback',
        element: lazyPage(
          () => import('@/features/auth/pages/AuthCallbackPage'),
          'AuthCallbackPage',
        ),
      },
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
      {
        path: 'workspaces/new',
        element: lazyPage(
          () => import('@/features/workspaces/pages/CreateWorkspacePage'),
          'CreateWorkspacePage',
        ),
      },
      {
        path: 'w/:workspaceId',
        element: <WorkspaceRoute />,
        children: [
          {
            index: true,
            element: lazyPage(() => import('@/app/pages/DashboardPage'), 'DashboardPage'),
          },
          {
            path: 'modules',
            element: lazyPage(() => import('@/features/modules/pages/ModulesPage'), 'ModulesPage'),
          },
          {
            path: 'modules/:moduleId',
            element: lazyPage(() => import('@/features/modules/pages/ModulePage'), 'ModulePage'),
          },
          {
            path: 'modules/:moduleId/settings',
            element: lazyPage(
              () => import('@/features/modules/pages/ModuleSettingsPage'),
              'ModuleSettingsPage',
            ),
          },
          {
            path: 'modules/:moduleId/records/new',
            element: lazyPage(
              () => import('@/features/records/pages/NewRecordPage'),
              'NewRecordPage',
            ),
          },
          {
            path: 'modules/:moduleId/records/:recordId',
            element: lazyPage(() => import('@/features/records/pages/RecordPage'), 'RecordPage'),
          },
          {
            path: 'members',
            element: lazyPage(() => import('@/features/members/pages/MembersPage'), 'MembersPage'),
          },
          {
            path: 'settings',
            element: lazyPage(
              () => import('@/features/workspaces/pages/WorkspaceSettingsPage'),
              'WorkspaceSettingsPage',
            ),
          },
        ],
      },
      {
        path: 'invite/:token',
        element: lazyPage(
          () => import('@/features/members/pages/AcceptInvitationPage'),
          'AcceptInvitationPage',
        ),
      },
      {
        path: 'settings/profile',
        element: lazyPage(
          () => import('@/features/profile/pages/ProfileSettingsPage'),
          'ProfileSettingsPage',
        ),
      },
      {
        path: '*',
        element: lazyPage(() => import('@/app/pages/NotFoundPage'), 'NotFoundPage'),
      },
    ],
  },
])
