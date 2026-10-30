import { describe, expect, it } from 'vitest'

import { NETWORK_ERROR_MESSAGE } from '@/lib/postgrest-errors'

import {
  GENERIC_WORKSPACE_ERROR_MESSAGE,
  SLUG_TAKEN_MESSAGE,
  WORKSPACE_NOT_FOUND_MESSAGE,
  WorkspaceNotFoundError,
  getWorkspaceErrorMessage,
} from './workspace-errors'

function pgError(code: string, message = 'raw database text') {
  return { code, message, details: '', hint: '', name: 'PostgrestError' }
}

describe('getWorkspaceErrorMessage', () => {
  it('maps a slug unique violation (23505) to the friendly slug-taken message', () => {
    expect(
      getWorkspaceErrorMessage(
        pgError('23505', 'duplicate key value violates unique constraint "workspaces_slug_key"'),
      ),
    ).toBe(SLUG_TAKEN_MESSAGE)
  })

  it('explains check violations (23514) in terms of name and slug rules', () => {
    expect(getWorkspaceErrorMessage(pgError('23514'))).toMatch(/lowercase letters/)
  })

  it('maps RLS denials and zero-row results', () => {
    expect(getWorkspaceErrorMessage(pgError('42501'))).toBe(
      'You are not allowed to change this workspace.',
    )
    expect(getWorkspaceErrorMessage(pgError('PGRST116'))).toBe(WORKSPACE_NOT_FOUND_MESSAGE)
    expect(getWorkspaceErrorMessage(new WorkspaceNotFoundError())).toBe(WORKSPACE_NOT_FOUND_MESSAGE)
  })

  it('reports network failures and never leaks raw text otherwise', () => {
    expect(getWorkspaceErrorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
    expect(getWorkspaceErrorMessage(pgError('XX000', 'internal detail'))).toBe(
      GENERIC_WORKSPACE_ERROR_MESSAGE,
    )
    expect(getWorkspaceErrorMessage(undefined)).toBe(GENERIC_WORKSPACE_ERROR_MESSAGE)
    expect(getWorkspaceErrorMessage('nope')).toBe(GENERIC_WORKSPACE_ERROR_MESSAGE)
  })
})
