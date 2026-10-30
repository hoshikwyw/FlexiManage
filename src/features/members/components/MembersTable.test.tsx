import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'
import type { WorkspaceRole } from '@/types/database'

import type { Member } from '../types'
import { MembersTable } from './MembersTable'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa'
const ALICE = '00000000-0000-0000-0000-00000000000a'
const BOB = '00000000-0000-0000-0000-00000000000b'
const CAROL = '00000000-0000-0000-0000-00000000000c'

function member(userId: string, role: WorkspaceRole, name: string, email: string): Member {
  return {
    workspace_id: WORKSPACE_ID,
    user_id: userId,
    role,
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
    profile: { id: userId, email, full_name: name, avatar_url: null },
  }
}

const members = [
  member(ALICE, 'owner', 'Alice Example', 'alice@example.com'),
  member(BOB, 'admin', 'Bob Example', 'bob@example.com'),
  member(CAROL, 'member', 'Carol Test', 'carol@example.com'),
]

function renderTable(callerRole: WorkspaceRole, callerUserId: string) {
  return renderWithProviders(
    <MembersTable
      workspaceId={WORKSPACE_ID}
      members={members}
      callerRole={callerRole}
      callerUserId={callerUserId}
    />,
  )
}

describe('MembersTable', () => {
  it('renders name, email, role badge and marks the caller', () => {
    renderTable('owner', ALICE)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText(/Alice Example/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('(you)')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('alice@example.com')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Owner')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Admin')).toBeInTheDocument()
  })

  it('shows owners the role actions and remove for other members', async () => {
    const user = userEvent.setup()
    renderTable('owner', ALICE)

    await user.click(screen.getByRole('button', { name: 'Actions for Bob Example' }))
    expect(await screen.findByRole('menuitem', { name: 'Make owner' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Make member' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Make admin' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove from workspace' })).toBeInTheDocument()
  })

  it('hides owner-only role actions from admins and blocks removing owners', async () => {
    const user = userEvent.setup()
    renderTable('admin', BOB)

    // Admins cannot touch an owner at all: no actions button on Alice's row.
    expect(
      screen.queryByRole('button', { name: 'Actions for Alice Example' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Actions for Carol Test' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Remove from workspace' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Make/ })).not.toBeInTheDocument()
  })

  it('offers plain members only the option to leave', async () => {
    const user = userEvent.setup()
    renderTable('member', CAROL)

    expect(
      screen.queryByRole('button', { name: 'Actions for Alice Example' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Actions for Bob Example' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Actions for Carol Test' }))
    expect(await screen.findByRole('menuitem', { name: 'Leave workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Make/ })).not.toBeInTheDocument()
  })
})
