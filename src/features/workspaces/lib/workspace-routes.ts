import type { WorkspaceMembership } from '../types'

/** Workspace-scoped URLs. Every tenant page lives under `/w/:workspaceId`. */
export const WORKSPACE_ROUTES = {
  root: '/',
  create: '/workspaces/new',
  dashboard: (workspaceId: string) => `/w/${workspaceId}`,
  members: (workspaceId: string) => `/w/${workspaceId}/members`,
  settings: (workspaceId: string) => `/w/${workspaceId}/settings`,
  modules: (workspaceId: string) => `/w/${workspaceId}/modules`,
  module: (workspaceId: string, moduleId: string) => `/w/${workspaceId}/modules/${moduleId}`,
  moduleSettings: (workspaceId: string, moduleId: string) =>
    `/w/${workspaceId}/modules/${moduleId}/settings`,
  newRecord: (workspaceId: string, moduleId: string) =>
    `/w/${workspaceId}/modules/${moduleId}/records/new`,
  record: (workspaceId: string, moduleId: string, recordId: string) =>
    `/w/${workspaceId}/modules/${moduleId}/records/${recordId}`,
  editRecord: (workspaceId: string, moduleId: string, recordId: string) =>
    `/w/${workspaceId}/modules/${moduleId}/records/${recordId}?edit=1`,
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

/**
 * Where to go after leaving or deleting `workspaceId`: the first remaining
 * workspace's dashboard, or the create page when none is left. Computed from
 * the list the caller already holds, so the page can navigate before the list
 * refetches and `WorkspaceRoute` never shows "Workspace not found" for the
 * workspace that was just left.
 */
export function routeAfterLeavingWorkspace(
  workspaces: readonly WorkspaceMembership[],
  workspaceId: string,
): string {
  const next = workspaces.find((m) => m.workspace.id !== workspaceId)
  return next ? WORKSPACE_ROUTES.dashboard(next.workspace.id) : WORKSPACE_ROUTES.create
}
