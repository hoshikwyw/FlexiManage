import { describe, expect, it } from 'vitest'

import { createTestMembership } from '@/test/workspace-context'

import {
  WORKSPACE_ROUTES,
  routeAfterLeavingWorkspace,
  swapWorkspaceInPath,
} from './workspace-routes'

describe('swapWorkspaceInPath', () => {
  it('keeps the sub-page when switching workspace', () => {
    expect(swapWorkspaceInPath('/w/aaa/members', 'bbb')).toBe('/w/bbb/members')
    expect(swapWorkspaceInPath('/w/aaa/settings', 'bbb')).toBe('/w/bbb/settings')
    expect(swapWorkspaceInPath('/w/aaa', 'bbb')).toBe('/w/bbb')
  })

  it('falls back to the dashboard for non-workspace paths', () => {
    expect(swapWorkspaceInPath('/settings/profile', 'bbb')).toBe(WORKSPACE_ROUTES.dashboard('bbb'))
    expect(swapWorkspaceInPath('/workspaces/new', 'bbb')).toBe('/w/bbb')
    expect(swapWorkspaceInPath('/', 'bbb')).toBe('/w/bbb')
  })
})

describe('routeAfterLeavingWorkspace', () => {
  const list = [
    createTestMembership({ id: 'aaa', name: 'A' }),
    createTestMembership({ id: 'bbb', name: 'B' }),
  ]

  it('goes to the first remaining workspace', () => {
    expect(routeAfterLeavingWorkspace(list, 'aaa')).toBe('/w/bbb')
    expect(routeAfterLeavingWorkspace(list, 'bbb')).toBe('/w/aaa')
  })

  it('goes to the create page when no workspace is left', () => {
    expect(routeAfterLeavingWorkspace([list[0]!], 'aaa')).toBe(WORKSPACE_ROUTES.create)
    expect(routeAfterLeavingWorkspace([], 'aaa')).toBe(WORKSPACE_ROUTES.create)
  })
})
