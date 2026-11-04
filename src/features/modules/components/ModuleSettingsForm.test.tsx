import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { createTestModule, TEST_WORKSPACE_ID } from '@/test/fields'
import { createQueryBuilderMock } from '@/test/query-builder-mock'
import { renderWithProviders } from '@/test/render'

import { ModuleSettingsForm } from './ModuleSettingsForm'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const from = vi.mocked(supabase.from)

function renderForm() {
  renderWithProviders(
    <ModuleSettingsForm workspaceId={TEST_WORKSPACE_ID} module={createTestModule()} />,
  )
}

async function submitSlug(slug: string) {
  const user = userEvent.setup()
  const input = screen.getByLabelText('Slug')
  await user.clear(input)
  await user.type(input, slug)
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  return input
}

describe('ModuleSettingsForm', () => {
  beforeEach(() => from.mockReset())

  it('puts a duplicate slug (23505) on the slug input', async () => {
    from.mockReturnValue(
      createQueryBuilderMock({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "modules_workspace_id_slug_key"',
          details: 'Key (workspace_id, slug)=(ws, leads) already exists.',
          hint: null,
        },
      }) as never,
    )
    renderForm()
    const input = await submitSlug('leads')

    expect(
      await screen.findByText('A module with this slug already exists in this workspace.'),
    ).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    // Field-level only: the form-level live region stays empty.
    expect(screen.queryByText(/could not be saved/)).not.toBeInTheDocument()
  })

  it('puts a duplicate name on the name input when the constraint names it', async () => {
    from.mockReturnValue(
      createQueryBuilderMock({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "modules_workspace_id_name_key"',
          details: 'Key (workspace_id, name)=(ws, Leads) already exists.',
          hint: null,
        },
      }) as never,
    )
    renderForm()
    await submitSlug('leads')
    expect(
      await screen.findByText('A module with this name already exists in this workspace.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Module name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('keeps other errors form-level', async () => {
    from.mockReturnValue(
      createQueryBuilderMock({
        data: null,
        error: { code: '42501', message: 'denied', details: null, hint: null },
      }) as never,
    )
    renderForm()
    await submitSlug('leads')
    expect(await screen.findByText(/not allowed to change modules/)).toBeInTheDocument()
    expect(screen.getByLabelText('Slug')).not.toHaveAttribute('aria-invalid', 'true')
  })
})
