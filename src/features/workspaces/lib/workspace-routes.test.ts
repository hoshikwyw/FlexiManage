import { describe, expect, it } from 'vitest'

import { WORKSPACE_ROUTES, swapWorkspaceInPath } from './workspace-routes'

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
