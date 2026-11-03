import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestField, TEST_MODULE_ID, TEST_WORKSPACE_ID } from '@/test/fields'
import { renderWithProviders } from '@/test/render'

import { useCreateField } from '../api/use-create-field'
import { useUpdateField } from '../api/use-update-field'
import { FieldDialog } from './FieldDialog'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

vi.mock('../api/use-create-field', () => ({ useCreateField: vi.fn() }))
vi.mock('../api/use-update-field', () => ({ useUpdateField: vi.fn() }))

const createMutate = vi.fn()
const updateMutate = vi.fn()

function renderDialog(props: Partial<Parameters<typeof FieldDialog>[0]> = {}) {
  return renderWithProviders(
    <FieldDialog
      workspaceId={TEST_WORKSPACE_ID}
      moduleId={TEST_MODULE_ID}
      open
      onOpenChange={() => {}}
      nextPosition={4}
      {...props}
    />,
  )
}

describe('FieldDialog', () => {
  beforeEach(() => {
    createMutate.mockReset()
    updateMutate.mockReset()
    vi.mocked(useCreateField).mockReturnValue({
      mutateAsync: createMutate,
      isPending: false,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useCreateField>)
    vi.mocked(useUpdateField).mockReturnValue({
      mutateAsync: updateMutate,
      isPending: false,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useUpdateField>)
  })

  it('derives the key from the label on create and lists the six types from the registry', async () => {
    const user = userEvent.setup()
    renderDialog()

    const label = await screen.findByLabelText('Label')
    await user.type(label, 'Due date')
    await waitFor(() => expect(screen.getByLabelText('Key')).toHaveValue('due_date'))

    const type = screen.getByLabelText('Type')
    expect(type).toBeEnabled()
    expect(within(type).getAllByRole('option')).toHaveLength(6)
    expect(screen.getByLabelText('Key')).toBeEnabled()
  })

  it('locks type and key when editing and explains why', async () => {
    const user = userEvent.setup()
    const field = createTestField({ key: 'vendor', label: 'Vendor', type: 'text' })
    renderDialog({ field })

    expect(await screen.findByRole('heading', { name: 'Edit Vendor' })).toBeInTheDocument()
    expect(screen.getByLabelText('Type')).toBeDisabled()
    expect(screen.getByLabelText('Key')).toBeDisabled()
    expect(screen.getByText(/The type cannot change once a field exists/)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Required' }))
    await user.click(screen.getByRole('button', { name: 'Save field' }))
    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith({
        fieldId: field.id,
        label: 'Vendor',
        required: true,
        options: [],
        settings: {},
      }),
    )
  })

  it('requires options for a select field and flags duplicate option values', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(await screen.findByLabelText('Label'), 'Status')
    await user.selectOptions(screen.getByLabelText('Type'), 'select')
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    expect(await screen.findByText('Add at least one option')).toBeInTheDocument()
    expect(createMutate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Add option' }))
    await user.type(screen.getByLabelText('Option 1 label'), 'Open')
    await user.click(screen.getByRole('button', { name: 'Add option' }))
    await user.type(screen.getByLabelText('Option 2 label'), 'Open')
    expect(screen.getByLabelText('Option 2 value')).toHaveTextContent('open')
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    expect(
      await screen.findByText('Duplicate of option 1; option values must be distinct'),
    ).toBeInTheDocument()
    expect(createMutate).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Option 2 label'))
    await user.type(screen.getByLabelText('Option 2 label'), 'Closed')
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() =>
      expect(createMutate).toHaveBeenCalledWith({
        label: 'Status',
        key: 'status',
        type: 'select',
        required: false,
        options: [
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
        ],
        settings: {},
        position: 4,
      }),
    )
  })

  it('prefills currency settings and sends them only for currency fields', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(await screen.findByLabelText('Label'), 'Price')
    await user.selectOptions(screen.getByLabelText('Type'), 'currency')
    await waitFor(() => expect(screen.getByLabelText('Currency')).toHaveValue('EUR'))
    expect(screen.getByLabelText('Decimal places')).toHaveValue(2)

    await user.selectOptions(screen.getByLabelText('Currency'), 'USD')
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() =>
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'currency',
          options: [],
          settings: { currency: 'USD', precision: 2 },
        }),
      ),
    )
  })
})
