import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { renderWithProviders } from '@/test/render'
import { createTestSession, createTestUser } from '@/test/supabase-mock'
import { createTestWorkspace } from '@/test/workspace-context'
import type { WorkspaceRole } from '@/types/database'

import { useCurrentWorkspace } from './workspace-context'
import { WorkspaceProvider } from './WorkspaceProvider'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const USER_ID = createTestUser().id
const OTHER_USER_ID = '00000000-0000-0000-0000-00000000000b'
const A = '00000000-0000-0000-0000-0000000000aa'
const B = '00000000-0000-0000-0000-0000000000bb'
const STORAGE_KEY = `fleximanage.currentWorkspace.${USER_ID}`

const getSession = vi.mocked(supabase.auth.getSession)
const from = vi.mocked(supabase.from)

function membershipRow(id: string, name: string, role: WorkspaceRole = 'owner') {
  return {
    role,
    created_at: '2026-10-30T00:00:00.000Z',
    workspace: createTestWorkspace({ id, name, slug: name.toLowerCase() }),
  }
}

/** `supabase.from('workspace_members').select(...).eq(...)` resolving to `rows`. */
function mockWorkspaceRows(rows: ReturnType<typeof membershipRow>[]) {
  const builder = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  }
  from.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>)
}

function Probe() {
  const { workspaceId, workspaces, isLoading, setWorkspaceId } = useCurrentWorkspace()
  if (isLoading) return <p>Loading workspaces</p>
  return (
    <div>
      <p data-testid="current">{workspaceId ?? 'none'}</p>
      <p data-testid="count">{workspaces.length}</p>
      <button type="button" onClick={() => setWorkspaceId(B)}>
        Select B
      </button>
    </div>
  )
}

function renderProvider() {
  return renderWithProviders(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  )
}

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getSession.mockResolvedValue({ data: { session: createTestSession() }, error: null })
    // Sorted by name: Alpha (A) comes before Beta (B).
    mockWorkspaceRows([membershipRow(B, 'Beta', 'member'), membershipRow(A, 'Alpha')])
  })

  it('defaults to the first workspace by name and persists it per user', async () => {
    renderProvider()

    expect(await screen.findByTestId('current')).toHaveTextContent(A)
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(A)
  })

  it('restores the stored selection of the signed-in user', async () => {
    window.localStorage.setItem(STORAGE_KEY, B)
    renderProvider()

    expect(await screen.findByTestId('current')).toHaveTextContent(B)
  })

  it('ignores another user’s stored choice (storage key is per user)', async () => {
    window.localStorage.setItem(`fleximanage.currentWorkspace.${OTHER_USER_ID}`, B)
    renderProvider()

    expect(await screen.findByTestId('current')).toHaveTextContent(A)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(A)
    expect(window.localStorage.getItem(`fleximanage.currentWorkspace.${OTHER_USER_ID}`)).toBe(B)
  })

  it('falls back to the first workspace when the stored id is no longer in the list', async () => {
    window.localStorage.setItem(STORAGE_KEY, '00000000-0000-0000-0000-00000000dead')
    renderProvider()

    expect(await screen.findByTestId('current')).toHaveTextContent(A)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(A)
  })

  it('setWorkspaceId switches the current workspace and persists it', async () => {
    const user = userEvent.setup()
    renderProvider()
    expect(await screen.findByTestId('current')).toHaveTextContent(A)

    await user.click(screen.getByRole('button', { name: 'Select B' }))

    expect(screen.getByTestId('current')).toHaveTextContent(B)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(B)
  })

  it('exposes no workspace for a user without memberships', async () => {
    mockWorkspaceRows([])
    renderProvider()

    expect(await screen.findByTestId('current')).toHaveTextContent('none')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
