import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestModule, TEST_WORKSPACE_ID } from '@/test/fields'
import { renderWithProviders } from '@/test/render'

import { useCreateModule } from '../api/use-create-module'
import { CreateModuleDialog } from './CreateModuleDialog'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

vi.mock('../api/use-create-module', () => ({ useCreateModule: vi.fn() }))

const mutateAsync = vi.fn()

function renderDialog(props: Partial<Parameters<typeof CreateModuleDialog>[0]> = {}) {
  return renderWithProviders(
    <CreateModuleDialog
      workspaceId={TEST_WORKSPACE_ID}
      existingModules={[{ name: 'Clients', slug: 'clients' }]}
      open
      onOpenChange={() => {}}
      {...props}
    />,
  )
}

describe('CreateModuleDialog', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    vi.mocked(useCreateModule).mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useCreateModule>)
  })

  it('lists Blank and the templates with a field preview, Blank selected by default', async () => {
    renderDialog()
    expect(await screen.findByRole('radio', { name: /Blank/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Housekeeping tasks/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Clients/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Fields of Housekeeping tasks' })).toHaveTextContent(
      'Room · select · required',
    )
    expect(screen.getByLabelText('Module name')).toHaveValue('')
  })

  it('derives the slug from the name until the slug is edited', async () => {
    const user = userEvent.setup()
    renderDialog()

    const name = await screen.findByLabelText('Module name')
    const slug = screen.getByLabelText('Slug')
    await user.type(name, 'Rooms & Suites')
    await waitFor(() => expect(slug).toHaveValue('rooms-suites'))

    await user.clear(slug)
    await user.type(slug, 'rooms')
    await user.type(name, ' 2')
    expect(slug).toHaveValue('rooms')
  })

  it('prefills the name from the chosen template and suffixes a taken name', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(await screen.findByRole('radio', { name: /Housekeeping tasks/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Module name')).toHaveValue('Housekeeping tasks'),
    )
    expect(screen.getByLabelText('Slug')).toHaveValue('housekeeping-tasks')

    await user.click(screen.getByRole('radio', { name: /Clients/ }))
    await waitFor(() => expect(screen.getByLabelText('Module name')).toHaveValue('Clients (2)'))
    expect(screen.getByLabelText('Slug')).toHaveValue('clients-2')
  })

  it('opens with the requested default template', async () => {
    renderDialog({ defaultTemplateId: 'housekeeping-tasks' })
    expect(await screen.findByRole('radio', { name: /Housekeeping tasks/ })).toBeChecked()
    expect(screen.getByLabelText('Module name')).toHaveValue('Housekeeping tasks')
  })

  it('submits the template id, icon and trimmed values, then closes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mutateAsync.mockResolvedValue({
      module: createTestModule({ id: 'new', name: 'Housekeeping tasks' }),
      fields: Array.from({ length: 8 }, () => ({})),
    })
    renderDialog({ onOpenChange, defaultTemplateId: 'housekeeping-tasks' })

    await screen.findByRole('radio', { name: /Housekeeping tasks/ })
    await user.type(screen.getByLabelText('Description (optional)'), '  Daily rounds ')
    await user.click(screen.getByRole('button', { name: 'Create module' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Housekeeping tasks',
        slug: 'housekeeping-tasks',
        description: 'Daily rounds',
        icon: 'bed-double',
        templateId: 'housekeeping-tasks',
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('puts a duplicate slug (23505) on the slug input, not in a form-level message', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mutateAsync.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "modules_workspace_id_slug_key"',
      details: 'Key (workspace_id, slug)=(ws, clients) already exists.',
      hint: null,
    })
    renderDialog({ onOpenChange })

    await user.type(await screen.findByLabelText('Module name'), 'Clients')
    await user.click(screen.getByRole('button', { name: 'Create module' }))

    expect(
      await screen.findByText('A module with this slug already exists in this workspace.'),
    ).toBeInTheDocument()
    const slug = screen.getByLabelText('Slug')
    expect(slug).toHaveAttribute('aria-invalid', 'true')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows validation errors and does not submit without a name', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(await screen.findByRole('button', { name: 'Create module' }))
    expect(await screen.findByText('Module name is required')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
