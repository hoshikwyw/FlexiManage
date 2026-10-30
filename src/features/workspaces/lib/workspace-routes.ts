/** Workspace-scoped URLs. Every tenant page lives under `/w/:workspaceId`. */
export const WORKSPACE_ROUTES = {
  root: '/',
  create: '/workspaces/new',
  dashboard: (workspaceId: string) => `/w/${workspaceId}`,
  members: (workspaceId: string) => `/w/${workspaceId}/members`,
  settings: (workspaceId: string) => `/w/${workspaceId}/settings`,
  invite: (token: string) => `/invite/${token}`,
} as const

const WORKSPACE_PATH = /^\/w\/[^/]+(\/.*)?$/

/**
 * Keeps the current sub-page when switching workspace: `/w/A/members` becomes
 * `/w/B/members`. Any other path falls back to the new workspace's dashboard.
 */
export function swapWorkspaceInPath(pathname: string, workspaceId: string): string {
  const match = WORKSPACE_PATH.exec(pathname)
  if (!match) return WORKSPACE_ROUTES.dashboard(workspaceId)
  return `${WORKSPACE_ROUTES.dashboard(workspaceId)}${match[1] ?? ''}`
}
