import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import {
  createTestMembership,
  createWorkspaceContextValue,
  renderWithWorkspace,
} from '@/test/workspace-context'

import { WorkspaceSwitcher } from './WorkspaceSwitcher'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const A = '00000000-0000-0000-0000-0000000000aa'
const B = '00000000-0000-0000-0000-0000000000bb'

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function App() {
  return (
    <>
      <WorkspaceSwitcher />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </>
  )
}

const twoWorkspaces = [
  createTestMembership({ id: A, name: 'Workspace A', slug: 'workspace-a' }, 'owner'),
  createTestMembership({ id: B, name: 'Workspace B', slug: 'workspace-b' }, 'member'),
]

describe('WorkspaceSwitcher', () => {
  it('shows the current workspace and lists every workspace with its role', async () => {
    const user = userEvent.setup()
    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: twoWorkspaces }),
      initialEntries: [`/w/${A}/members`],
    })

    const trigger = screen.getByRole('button', { name: /Current workspace: Workspace A/ })
    expect(trigger).toHaveTextContent('Workspace A')
    expect(trigger).toHaveTextContent('Owner')

    await user.click(trigger)
    const items = await screen.findAllByRole('menuitem')
    const labels = items.map((item) => item.textContent)
    expect(labels.some((text) => text?.includes('Workspace A') && text.includes('Owner'))).toBe(
      true,
    )
    expect(labels.some((text) => text?.includes('Workspace B') && text.includes('Member'))).toBe(
      true,
    )
    expect(screen.getByRole('menuitem', { name: /Create workspace/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Workspace settings/ })).toBeInTheDocument()

    const current = items.find((item) => item.textContent?.includes('Workspace A'))
    expect(current).toHaveAttribute('aria-current', 'true')
  })

  it('switches workspace and keeps the current sub-page', async () => {
    const user = userEvent.setup()
    const value = createWorkspaceContextValue({ workspaces: twoWorkspaces })
    renderWithWorkspace(<App />, { value, initialEntries: [`/w/${A}/members`] })

    await user.click(screen.getByRole('button', { name: /Switch workspace/ }))
    const items = await screen.findAllByRole('menuitem')
    const target = items.find((item) => item.textContent?.includes('Workspace B'))!
    await user.click(within(target).getByText('Workspace B'))

    expect(value.setWorkspaceId).toHaveBeenCalledWith(B)
    expect(await screen.findByTestId('location')).toHaveTextContent(`/w/${B}/members`)
  })

  it('offers only "Create workspace" when the user has no workspace', () => {
    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [] }),
    })
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch workspace/ })).not.toBeInTheDocument()
  })

  it('shows a skeleton while loading and a retry on error', () => {
    const refetch = vi.fn()
    const { unmount } = renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [], isLoading: true }),
    })
    expect(screen.getByLabelText('Loading workspaces')).toBeInTheDocument()
    unmount()

    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [], isError: true, refetch }),
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Workspaces could not be loaded.')
  })
})
