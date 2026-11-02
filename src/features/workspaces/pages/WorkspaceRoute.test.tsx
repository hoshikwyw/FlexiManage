import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import {
  createTestMembership,
  createWorkspaceContextValue,
  renderWithWorkspace,
} from '@/test/workspace-context'

import { RootRedirect } from './RootRedirect'
import { WorkspaceRoute } from './WorkspaceRoute'

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

function LocationProbe({ label }: { label: string }) {
  const location = useLocation()
  return (
    <p>
      {label} at {location.pathname}
    </p>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/workspaces/new" element={<LocationProbe label="Create page" />} />
      <Route path="/w/:workspaceId" element={<WorkspaceRoute />}>
        <Route index element={<LocationProbe label="Dashboard" />} />
      </Route>
    </Routes>
  )
}

const memberOfA = [createTestMembership({ id: A, name: 'Workspace A', slug: 'workspace-a' })]
const memberOfAandB = [
  ...memberOfA,
  createTestMembership({ id: B, name: 'Workspace B', slug: 'workspace-b' }, 'member'),
]

describe('WorkspaceRoute', () => {
  it('renders the child page when the URL matches the current workspace', async () => {
    const value = createWorkspaceContextValue({ workspaces: memberOfA })
    renderWithWorkspace(<App />, { value, initialEntries: [`/w/${A}`] })

    expect(await screen.findByText(`Dashboard at /w/${A}`)).toBeInTheDocument()
    expect(value.setWorkspaceId).not.toHaveBeenCalled()
  })

  it('shows a 404 page for a workspace the user is not a member of', () => {
    const value = createWorkspaceContextValue({ workspaces: memberOfA })
    renderWithWorkspace(<App />, { value, initialEntries: [`/w/${B}`] })

    expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to my workspaces' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/Dashboard at/)).not.toBeInTheDocument()
    expect(value.setWorkspaceId).not.toHaveBeenCalled()
  })

  it('selects the workspace from the URL and waits for the provider to agree', () => {
    // Current is A, the URL asks for B (also a membership).
    const value = createWorkspaceContextValue({ workspaces: memberOfAandB })
    renderWithWorkspace(<App />, { value, initialEntries: [`/w/${B}`] })

    expect(value.setWorkspaceId).toHaveBeenCalledWith(B)
    expect(screen.getByRole('status', { name: 'Switching workspace' })).toBeInTheDocument()
    expect(screen.queryByText(/Dashboard at/)).not.toBeInTheDocument()
  })

  it('shows a spinner while the list loads and a retry on error', () => {
    const { unmount } = renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [], isLoading: true }),
      initialEntries: [`/w/${A}`],
    })
    expect(screen.getByRole('status', { name: 'Loading workspace' })).toBeInTheDocument()
    unmount()

    const refetch = vi.fn()
    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [], isError: true, refetch }),
      initialEntries: [`/w/${A}`],
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Workspaces could not be loaded')
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalled()
  })
})

describe('RootRedirect', () => {
  it('redirects to the current workspace dashboard', async () => {
    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: memberOfA }),
      initialEntries: ['/'],
    })

    expect(await screen.findByText(`Dashboard at /w/${A}`)).toBeInTheDocument()
  })

  it('redirects to the create page when the user has no workspace', async () => {
    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [] }),
      initialEntries: ['/'],
    })

    expect(await screen.findByText('Create page at /workspaces/new')).toBeInTheDocument()
  })

  it('shows a spinner while the list loads', () => {
    renderWithWorkspace(<App />, {
      value: createWorkspaceContextValue({ workspaces: [], isLoading: true }),
      initialEntries: ['/'],
    })

    expect(screen.getByRole('status', { name: 'Loading your workspaces' })).toBeInTheDocument()
    expect(screen.queryByText(/Create page/)).not.toBeInTheDocument()
  })
})
