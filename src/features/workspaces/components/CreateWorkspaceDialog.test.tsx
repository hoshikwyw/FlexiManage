import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestWorkspace, renderWithWorkspace } from '@/test/workspace-context'

import { useCreateWorkspace } from '../api/use-create-workspace'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

vi.mock('../api/use-create-workspace', () => ({ useCreateWorkspace: vi.fn() }))

const mutateAsync = vi.fn()

describe('CreateWorkspaceDialog', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    vi.mocked(useCreateWorkspace).mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useCreateWorkspace>)
  })

  it('derives the slug from the name until the user edits the slug', async () => {
    const user = userEvent.setup()
    renderWithWorkspace(<CreateWorkspaceDialog open onOpenChange={() => {}} />)

    const name = await screen.findByLabelText('Workspace name')
    const slug = screen.getByLabelText('Slug')

    await user.type(name, 'Pilot Co')
    await waitFor(() => expect(slug).toHaveValue('pilot-co'))

    await user.clear(slug)
    await user.type(slug, 'custom-slug')
    await user.type(name, ' Two')
    expect(name).toHaveValue('Pilot Co Two')
    expect(slug).toHaveValue('custom-slug')
  })

  it('shows validation errors and does not submit when fields are invalid', async () => {
    const user = userEvent.setup()
    renderWithWorkspace(<CreateWorkspaceDialog open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Create workspace' }))
    expect(await screen.findByText('Workspace name is required')).toBeInTheDocument()
    expect(screen.getByText('Slug is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Workspace name'), 'Pilot Co')
    const slug = screen.getByLabelText('Slug')
    await user.clear(slug)
    await user.type(slug, 'Bad Slug!')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))
    expect(
      await screen.findByText(/lowercase letters, numbers and single hyphens/),
    ).toBeInTheDocument()
    expect(slug).toHaveAttribute('aria-invalid', 'true')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('submits trimmed values, selects the new workspace and closes', async () => {
    const user = userEvent.setup()
    const created = createTestWorkspace({ id: 'new-id', name: 'Pilot Co', slug: 'pilot-co' })
    mutateAsync.mockResolvedValue(created)
    const onOpenChange = vi.fn()
    const { value } = renderWithWorkspace(
      <CreateWorkspaceDialog open onOpenChange={onOpenChange} />,
    )

    await user.type(await screen.findByLabelText('Workspace name'), '  Pilot Co  ')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ name: 'Pilot Co', slug: 'pilot-co' }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(value.setWorkspaceId).toHaveBeenCalledWith('new-id')
  })
})
