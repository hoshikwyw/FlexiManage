import { FunctionsHttpError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { createTestQueryClient } from '@/test/render'
import { createTestSession } from '@/test/supabase-mock'
import { createWorkspaceContextValue, renderWithWorkspace } from '@/test/workspace-context'

import { memberKeys } from '../api/keys'
import type { AcceptInvitationResult } from '../types'
import { AcceptInvitationPage } from './AcceptInvitationPage'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const TOKEN = 'tok_0123456789abcdef'
const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa'

const getSession = vi.mocked(supabase.auth.getSession)
const invoke = vi.mocked(supabase.functions.invoke)

const accepted: AcceptInvitationResult = {
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Pilot Co',
  workspaceSlug: 'pilot-co',
  role: 'member',
}

function functionFailure(status: number, code: string) {
  return {
    data: null,
    error: new FunctionsHttpError(
      new Response(JSON.stringify({ error: { code, message: 'server text' } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <p>Dashboard at {location.pathname}</p>
}

function App() {
  return (
    <Routes>
      <Route path="/invite/:token" element={<AcceptInvitationPage />} />
      <Route path="/w/:workspaceId" element={<LocationProbe />} />
    </Routes>
  )
}

function renderPage(queryClient = createTestQueryClient()) {
  return renderWithWorkspace(<App />, {
    value: createWorkspaceContextValue({ workspaces: [] }),
    queryClient,
    initialEntries: [`/invite/${TOKEN}`],
  })
}

describe('AcceptInvitationPage', () => {
  beforeEach(() => {
    invoke.mockReset()
    getSession.mockResolvedValue({ data: { session: createTestSession() }, error: null })
  })

  it('accepts the invitation once, selects the workspace and lands on its dashboard', async () => {
    invoke.mockResolvedValue({ data: { data: accepted }, error: null })
    const { value } = renderPage()

    expect(screen.getByText('Joining workspace')).toBeInTheDocument()

    expect(await screen.findByText(`Dashboard at /w/${WORKSPACE_ID}`)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('accept-invitation', { body: { token: TOKEN } })
    expect(value.setWorkspaceId).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('does not replay a cached success when the link is opened again in the same session', async () => {
    const queryClient = createTestQueryClient()
    invoke.mockResolvedValueOnce({ data: { data: accepted }, error: null })
    const first = renderPage(queryClient)
    expect(await screen.findByText(`Dashboard at /w/${WORKSPACE_ID}`)).toBeInTheDocument()
    first.unmount()

    // The page dropped its result on unmount; the second visit asks the server again.
    await waitFor(() => {
      expect(
        queryClient.getQueryCache().find({ queryKey: memberKeys.accept(TOKEN) }),
      ).toBeUndefined()
    })
    invoke.mockResolvedValueOnce(functionFailure(404, 'not_found'))
    const second = renderPage(queryClient)

    expect(await screen.findByText('This invitation is no longer valid')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(second.value.setWorkspaceId).not.toHaveBeenCalled()
  })

  it.each([
    [404, 'not_found', 'This invitation is no longer valid'],
    [410, 'invitation_expired', 'This invitation has expired'],
    [403, 'forbidden', 'This invitation was sent to a different email address'],
  ])('shows the mapped message for a %i %s response', async (status, code, title) => {
    invoke.mockResolvedValue(functionFailure(status, code))
    const { value } = renderPage()

    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(title)
    expect(screen.getByRole('link', { name: 'Go to my workspaces' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/Dashboard at/)).not.toBeInTheDocument()
    expect(value.setWorkspaceId).not.toHaveBeenCalled()
  })

  it('never shows the raw server message', async () => {
    invoke.mockResolvedValue(functionFailure(500, 'internal'))
    renderPage()

    expect(await screen.findByText('The invitation could not be accepted')).toBeInTheDocument()
    expect(screen.queryByText(/server text/)).not.toBeInTheDocument()
  })
})
