import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useSession } from '@/features/auth/api/use-session'

import { useWorkspaces } from '../api/use-workspaces'
import { readStoredWorkspaceId, writeStoredWorkspaceId } from '../lib/workspace-storage'
import type { WorkspaceMembership } from '../types'
import { WorkspaceContext, type CurrentWorkspaceValue } from './workspace-context'

const EMPTY: WorkspaceMembership[] = []

interface Selection {
  userId: string
  workspaceId: string
}

/**
 * Holds the selected workspace for the signed-in user. The selection is kept
 * in localStorage per user id and defaults to the first workspace (by name).
 * When the selected workspace disappears from the list (left or deleted) the
 * selection falls back to the first remaining one.
 *
 * Mounted once inside the protected layout; workspace-scoped routes
 * (`/w/:workspaceId`) call `setWorkspaceId` so the URL stays the source of truth.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const userId = user?.id
  const query = useWorkspaces(userId)
  const workspaces = query.data ?? EMPTY

  // In-session choice; ignored once a different user signs in, so the stored
  // value of the new user wins without an effect.
  const [selection, setSelection] = useState<Selection | null>(null)
  const requestedId =
    selection && selection.userId === userId
      ? selection.workspaceId
      : userId
        ? readStoredWorkspaceId(userId)
        : null

  const current = useMemo(() => {
    if (workspaces.length === 0) return null
    return workspaces.find((m) => m.workspace.id === requestedId) ?? workspaces[0] ?? null
  }, [requestedId, workspaces])

  // Persist the effective selection (covers the fallback to the first workspace).
  useEffect(() => {
    if (!userId || !current) return
    if (readStoredWorkspaceId(userId) !== current.workspace.id) {
      writeStoredWorkspaceId(userId, current.workspace.id)
    }
  }, [current, userId])

  const setWorkspaceId = useCallback(
    (workspaceId: string) => {
      if (!userId) return
      setSelection({ userId, workspaceId })
      writeStoredWorkspaceId(userId, workspaceId)
    },
    [userId],
  )

  const refetch = useCallback(() => {
    void query.refetch()
  }, [query])

  const value = useMemo<CurrentWorkspaceValue>(
    () => ({
      workspaces,
      workspace: current?.workspace ?? null,
      role: current?.role ?? null,
      workspaceId: current?.workspace.id ?? null,
      setWorkspaceId,
      isLoading: query.isPending,
      isError: query.isError,
      error: query.error,
      refetch,
    }),
    [current, query.error, query.isError, query.isPending, refetch, setWorkspaceId, workspaces],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
