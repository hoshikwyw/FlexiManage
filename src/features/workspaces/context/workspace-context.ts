import { createContext, useContext } from 'react'

import type { Workspace, WorkspaceRole } from '@/types/database'

import type { WorkspaceMembership } from '../types'

export interface CurrentWorkspaceValue {
  /** Every workspace the user belongs to, sorted by name. */
  workspaces: WorkspaceMembership[]
  /** The selected workspace, or null while loading or when the user has none. */
  workspace: Workspace | null
  /** The caller's role in the selected workspace. */
  role: WorkspaceRole | null
  workspaceId: string | null
  /** Select a workspace (must be one of `workspaces`); persisted per user. */
  setWorkspaceId: (workspaceId: string) => void
  /** True until the first workspace list has loaded. */
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
}

export const WorkspaceContext = createContext<CurrentWorkspaceValue | null>(null)

/** The current workspace and the user's role in it. Must be used under `WorkspaceProvider`. */
export function useCurrentWorkspace(): CurrentWorkspaceValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useCurrentWorkspace must be used within <WorkspaceProvider>')
  }
  return value
}
