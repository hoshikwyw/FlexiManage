import type { ReactElement } from 'react'
import { vi } from 'vitest'

import {
  WorkspaceContext,
  type CurrentWorkspaceValue,
} from '@/features/workspaces/context/workspace-context'
import type { WorkspaceMembership } from '@/features/workspaces/types'
import type { Workspace, WorkspaceRole } from '@/types/database'

import { renderWithProviders } from './render'

export function createTestWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    name: 'Workspace A',
    slug: 'workspace-a',
    created_by: '00000000-0000-0000-0000-00000000000a',
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}

export function createTestMembership(
  workspace: Partial<Workspace>,
  role: WorkspaceRole = 'owner',
): WorkspaceMembership {
  return { workspace: createTestWorkspace(workspace), role, joinedAt: '2026-10-30T00:00:00.000Z' }
}

/** A ready-made context value; pass overrides for the case under test. */
export function createWorkspaceContextValue(
  overrides: Partial<CurrentWorkspaceValue> = {},
): CurrentWorkspaceValue {
  const workspaces = overrides.workspaces ?? [createTestMembership({})]
  const current = workspaces[0] ?? null
  return {
    workspaces,
    workspace: current?.workspace ?? null,
    role: current?.role ?? null,
    workspaceId: current?.workspace.id ?? null,
    setWorkspaceId: vi.fn(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

/** `renderWithProviders` plus a stubbed `WorkspaceProvider` value. */
export function renderWithWorkspace(
  ui: ReactElement,
  {
    value = createWorkspaceContextValue(),
    ...options
  }: Parameters<typeof renderWithProviders>[1] & { value?: CurrentWorkspaceValue } = {},
) {
  return {
    value,
    ...renderWithProviders(
      <WorkspaceContext.Provider value={value}>{ui}</WorkspaceContext.Provider>,
      options,
    ),
  }
}
