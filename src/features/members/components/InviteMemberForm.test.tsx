import { FunctionsHttpError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { renderWithProviders } from '@/test/render'

import { MEMBER_ERROR_MESSAGES } from '../lib/member-errors'
import { InviteMemberForm } from './InviteMemberForm'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const invoke = vi.mocked(supabase.functions.invoke)
const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa'

function optionLabels() {
  return screen.getAllByRole('option').map((option) => option.textContent)
}

describe('InviteMemberForm', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('offers owner, admin and member to an owner', () => {
    renderWithProviders(<InviteMemberForm workspaceId={WORKSPACE_ID} callerRole="owner" />)
    expect(optionLabels()).toEqual(['Owner', 'Admin', 'Member'])
    expect(screen.getByLabelText('Role')).toHaveValue('member')
  })

  it('offers only admin and member to an admin', () => {
    renderWithProviders(<InviteMemberForm workspaceId={WORKSPACE_ID} callerRole="admin" />)
    expect(optionLabels()).toEqual(['Admin', 'Member'])
  })

  it('validates the email before calling the function', async () => {
    const user = userEvent.setup()
    renderWithProviders(<InviteMemberForm workspaceId={WORKSPACE_ID} callerRole="owner" />)

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('calls invite-member with the workspace id, normalised email and role', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({
      data: {
        data: { id: 'inv-1', email: 'bob@example.com', role: 'admin', expiresAt: '2026-11-06' },
      },
      error: null,
    } as Awaited<ReturnType<typeof supabase.functions.invoke>>)
    renderWithProviders(<InviteMemberForm workspaceId={WORKSPACE_ID} callerRole="owner" />)

    await user.type(screen.getByLabelText('Email'), '  Bob@Example.com ')
    await user.selectOptions(screen.getByLabelText('Role'), 'admin')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('invite-member', {
        body: { workspaceId: WORKSPACE_ID, email: 'bob@example.com', role: 'admin' },
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue(''))
  })

  it('surfaces a mapped message for a 409 conflict from the function', async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        new Response(JSON.stringify({ error: { code: 'conflict', message: 'raw server text' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    } as Awaited<ReturnType<typeof supabase.functions.invoke>>)
    renderWithProviders(<InviteMemberForm workspaceId={WORKSPACE_ID} callerRole="admin" />)

    await user.type(screen.getByLabelText('Email'), 'bob@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    const alert = await screen.findByText(MEMBER_ERROR_MESSAGES.conflict)
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled()
  })
})
