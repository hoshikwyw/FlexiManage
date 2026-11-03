import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'

import { createClientsFields, createTestField } from '@/test/fields'
import { renderWithProviders } from '@/test/render'
import type { FieldDefinition } from '@/types/database'

import { emptyRecordFormValues, recordToFormValues, type RecordFormValues } from '../schemas/record'
import { RecordForm } from './RecordForm'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

type SubmitMock = Mock<(values: RecordFormValues) => Promise<void>>

function renderForm({
  fields = createClientsFields(),
  defaultValues = emptyRecordFormValues(fields),
  onSubmit = vi.fn<(values: RecordFormValues) => Promise<void>>().mockResolvedValue(undefined),
  onCancel = vi.fn<() => void>(),
  onFieldsStale = vi.fn<() => void>(),
  mode = 'create',
}: {
  fields?: FieldDefinition[]
  defaultValues?: RecordFormValues
  onSubmit?: SubmitMock
  onCancel?: Mock<() => void>
  onFieldsStale?: Mock<() => void>
  mode?: 'create' | 'edit'
} = {}) {
  renderWithProviders(
    <RecordForm
      fields={fields}
      defaultValues={defaultValues}
      mode={mode}
      pending={false}
      onSubmit={onSubmit}
      onCancel={onCancel}
      onFieldsStale={onFieldsStale}
    />,
  )
  return { onSubmit, onCancel, onFieldsStale }
}

const check = (message: string) => ({ code: '23514', message, details: null, hint: null })

describe('RecordForm', () => {
  it('renders one control per field in module order after title and status', () => {
    renderForm()
    const labels = Array.from(document.querySelectorAll('label')).map((l) => l.textContent?.trim())
    expect(labels).toEqual([
      'Title',
      'Record status',
      'Company* (required)',
      'Contact email',
      'Status',
      'Contract value',
    ])
  })

  it('requires a title and the required fields before sending anything', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await user.click(screen.getByRole('button', { name: 'Create record' }))
    expect(await screen.findByText('Enter a title')).toBeInTheDocument()
    expect(screen.getByLabelText(/Company/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('This field is required')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('validates numbers and select options from the definitions', async () => {
    const user = userEvent.setup()
    const fields = [
      createTestField({ key: 'rooms', label: 'Rooms', type: 'number', settings: { precision: 0 } }),
      createTestField({
        key: 'tier',
        label: 'Tier',
        type: 'select',
        position: 1,
        options: [{ value: 'gold', label: 'Gold' }],
      }),
    ]
    const { onSubmit } = renderForm({
      fields,
      defaultValues: { title: 'X', status: '', custom_values: { rooms: null, tier: 'gone' } },
    })
    expect(screen.getByLabelText('Tier')).toHaveDisplayValue('gone (removed option)')
    await user.type(screen.getByLabelText('Rooms'), '2.5')
    await user.click(screen.getByRole('button', { name: 'Create record' }))
    expect(await screen.findByText('Enter a whole number')).toBeInTheDocument()
    expect(screen.getByText('Choose one of the current options')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Rooms'))
    await user.type(screen.getByLabelText('Rooms'), '3')
    await user.selectOptions(screen.getByLabelText('Tier'), 'gold')
    await user.click(screen.getByRole('button', { name: 'Create record' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'X',
        status: '',
        custom_values: { rooms: 3, tier: 'gold' },
      }),
    )
  })

  it('submits typed values, including a parsed currency number', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await user.type(screen.getByLabelText('Title'), 'Umbrella Corp')
    await user.type(screen.getByLabelText(/Company/), 'Umbrella')
    await user.selectOptions(screen.getByLabelText('Status'), 'active')
    await user.type(screen.getByLabelText('Contract value'), '1234.5')
    await user.click(screen.getByRole('button', { name: 'Create record' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Umbrella Corp',
        status: '',
        custom_values: { company: 'Umbrella', contact_email: '', status: 'active', value: 1234.5 },
      }),
    )
  })

  it('puts a server 23514 custom_values error on the named field', async () => {
    const user = userEvent.setup()
    const onSubmit: SubmitMock = vi
      .fn()
      .mockRejectedValue(check('custom_values.value: expected number'))
    const { onFieldsStale } = renderForm({
      onSubmit,
      defaultValues: {
        title: 'Acme',
        status: '',
        custom_values: { company: 'Acme', contact_email: '', status: null, value: 5 },
      },
      mode: 'edit',
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Enter a number')).toBeInTheDocument()
    expect(screen.getByLabelText('Contract value')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Some values need attention/)).toBeInTheDocument()
    expect(onFieldsStale).not.toHaveBeenCalled()
  })

  it('stale record: a required field added later is shown on that field and refreshes the definitions', async () => {
    const user = userEvent.setup()
    // The form still has the old definitions in which Region is optional.
    const fields = [
      ...createClientsFields(),
      createTestField({ key: 'region', label: 'Region', position: 4 }),
    ]
    const record = { title: 'Acme', status: null, custom_values: { company: 'Acme' } }
    const onSubmit: SubmitMock = vi.fn().mockRejectedValue(check('custom_values.region: required'))
    const { onFieldsStale } = renderForm({
      fields,
      defaultValues: recordToFormValues(record, fields),
      onSubmit,
      mode: 'edit',
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toHaveAttribute('aria-invalid', 'true')
    expect(onFieldsStale).not.toHaveBeenCalled()
  })

  it('stale definitions: an unknown required key asks to refetch the fields', async () => {
    const user = userEvent.setup()
    const onSubmit: SubmitMock = vi.fn().mockRejectedValue(check('custom_values.region: required'))
    const { onFieldsStale } = renderForm({
      onSubmit,
      defaultValues: {
        title: 'Acme',
        status: '',
        custom_values: { company: 'Acme', contact_email: '', status: null, value: null },
      },
      mode: 'edit',
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/fields of this module changed/)).toBeInTheDocument()
    expect(onFieldsStale).toHaveBeenCalledTimes(1)
  })

  it('shows the forbidden copy for 42501', async () => {
    const user = userEvent.setup()
    const onSubmit: SubmitMock = vi
      .fn()
      .mockRejectedValue({ code: '42501', message: 'new row violates RLS' })
    renderForm({
      onSubmit,
      fields: [],
      defaultValues: { title: 'Acme', status: '', custom_values: {} },
    })
    await user.click(screen.getByRole('button', { name: 'Create record' }))
    expect(await screen.findByText(/not allowed to change records/)).toBeInTheDocument()
  })

  it('asks before discarding unsaved changes and cancels directly when pristine', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.type(screen.getByLabelText('Title'), 'Draft')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
