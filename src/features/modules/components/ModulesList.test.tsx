import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createTestModule, TEST_WORKSPACE_ID } from '@/test/fields'
import { renderWithProviders } from '@/test/render'

import type { ModuleSummary } from '../types'
import { ModulesList } from './ModulesList'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const modules: ModuleSummary[] = [
  { ...createTestModule({ id: 'm1', name: 'Clients', slug: 'clients' }), fieldCount: 4 },
  {
    ...createTestModule({
      id: 'm2',
      name: 'Rooms',
      slug: 'rooms',
      description: 'Per-room tasks',
      icon: null,
    }),
    fieldCount: 0,
  },
]

describe('ModulesList', () => {
  it('offers "Start from a template" to owners and admins when empty', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    renderWithProviders(
      <ModulesList
        workspaceId={TEST_WORKSPACE_ID}
        modules={[]}
        canManage
        onStartFromTemplate={onStart}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No modules yet' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start from a template' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('shows members the empty state without the template button', () => {
    renderWithProviders(
      <ModulesList
        workspaceId={TEST_WORKSPACE_ID}
        modules={[]}
        canManage={false}
        onStartFromTemplate={vi.fn()}
      />,
    )
    expect(screen.getByText(/An owner or admin can create the first one/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start from a template' })).not.toBeInTheDocument()
  })

  it('renders a card per module with name, description, field count and links', () => {
    renderWithProviders(<ModulesList workspaceId={TEST_WORKSPACE_ID} modules={modules} canManage />)
    const items = within(screen.getByRole('list', { name: 'Modules' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'href',
      `/w/${TEST_WORKSPACE_ID}/modules/m1`,
    )
    expect(within(items[0]!).getByText('4')).toBeInTheDocument()
    expect(within(items[0]!).getByRole('link', { name: 'Manage Clients' })).toHaveAttribute(
      'href',
      `/w/${TEST_WORKSPACE_ID}/modules/m1/settings`,
    )
    expect(within(items[1]!).getByText('Per-room tasks')).toBeInTheDocument()
    expect(within(items[0]!).getByText('No description.')).toBeInTheDocument()
  })

  it('hides the manage link from members', () => {
    renderWithProviders(
      <ModulesList workspaceId={TEST_WORKSPACE_ID} modules={modules} canManage={false} />,
    )
    expect(screen.queryByRole('link', { name: /^Manage/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(2)
  })
})
