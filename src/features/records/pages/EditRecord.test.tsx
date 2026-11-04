import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import {
  TEST_MODULE_ID,
  TEST_WORKSPACE_ID,
  createClientsFields,
  createTestField,
  createTestModule,
} from '@/test/fields'
import { createQueryBuilderMock } from '@/test/query-builder-mock'
import { renderWithProviders } from '@/test/render'

import { RECORD_CONFLICT_MESSAGE } from '../lib/record-conflict'
import type { RecordItem } from '../types'
import { EditRecord } from './EditRecord'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const RECORD_ID = '00000000-0000-0000-0000-0000000e0001'
const T1 = '2026-11-04T09:00:00.000000+00:00'
const T2 = '2026-11-04T09:05:00.000000+00:00'

const fields = [
  ...createClientsFields(),
  createTestField({ key: 'vip', label: 'VIP', type: 'checkbox', position: 4 }),
]

function record(overrides: Partial<RecordItem> = {}): RecordItem {
  return {
    id: RECORD_ID,
    workspace_id: TEST_WORKSPACE_ID,
    module_id: TEST_MODULE_ID,
    title: 'Acme',
    status: null,
    // `vip` was never set.
    custom_values: { company: 'Acme', status: 'lead', value: 1200 },
    created_by: null,
    created_at: '2026-11-03T00:00:00.000Z',
    updated_at: T1,
    ...overrides,
  }
}

const rpc = vi.mocked(supabase.rpc)
const from = vi.mocked(supabase.from)

function renderEdit(onDone = vi.fn()) {
  renderWithProviders(
    <EditRecord
      workspaceId={TEST_WORKSPACE_ID}
      module={createTestModule()}
      fields={fields}
      record={record()}
      onDone={onDone}
    />,
  )
  return { onDone }
}

async function retitle(user: ReturnType<typeof userEvent.setup>, title: string) {
  const input = screen.getByLabelText('Title')
  await user.clear(input)
  await user.type(input, title)
}

describe('EditRecord (update_record)', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
  })

  it('a title-only edit of a record with a never-set checkbox sends only the title', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValue({
      data: record({ title: 'Acme Ltd', updated_at: T2 }),
      error: null,
    } as never)
    const { onDone } = renderEdit()

    expect(screen.getByRole('checkbox', { name: 'VIP' })).not.toBeChecked()
    await retitle(user, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('update_record', {
      p_record_id: RECORD_ID,
      p_expected_updated_at: T1,
      p_patch: { title: 'Acme Ltd' },
    })
  })

  it('sends set and unset for changed custom values and nothing for an unchanged form', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValue({ data: record(), error: null } as never)
    const { onDone } = renderEdit()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(rpc).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Contract value'))
    await user.click(screen.getByRole('checkbox', { name: 'VIP' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_patch: { set: { vip: true }, unset: ['value'] },
    })
  })

  it('PT409: keeps the edits, reloads the latest version and saves against it', async () => {
    const user = userEvent.setup()
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PT409', message: 'record_changed', details: null, hint: null },
      } as never)
      .mockResolvedValueOnce({
        data: record({ updated_at: '2026-11-04T09:06:00Z' }),
        error: null,
      } as never)
    // Someone else renamed the company and set a contract value meanwhile.
    const latest = record({
      custom_values: { company: 'Acme Group', status: 'lead', value: 1300 },
      updated_at: T2,
    })
    from.mockReturnValue(createQueryBuilderMock({ data: latest, error: null }) as never)
    const { onDone } = renderEdit()

    await retitle(user, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(RECORD_CONFLICT_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Acme Ltd')
    expect(onDone).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByLabelText(/Company/)).toHaveValue('Acme Group'))
    expect(screen.getByLabelText('Title')).toHaveValue('Acme Ltd')
    expect(screen.getByLabelText('Contract value')).toHaveValue(1300)
    expect(screen.queryByText(RECORD_CONFLICT_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Loaded the latest version/)
    expect(from).toHaveBeenCalledWith('records')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1]?.[1]).toEqual({
      p_record_id: RECORD_ID,
      p_expected_updated_at: T2,
      p_patch: { title: 'Acme Ltd' },
    })
  })

  it('PT409: a failed reload keeps the banner and the edits', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', message: 'record_changed', details: null, hint: null },
    } as never)
    from.mockReturnValue(
      createQueryBuilderMock({ data: null, error: { code: 'XX000', message: 'boom' } }) as never,
    )
    renderEdit()

    await retitle(user, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await user.click(await screen.findByRole('button', { name: 'Reload' }))
    expect(await screen.findByText(/latest version could not be loaded/)).toBeInTheDocument()
    expect(screen.getByText(RECORD_CONFLICT_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Acme Ltd')
  })

  it('PT404 shows the not-found copy', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT404', message: 'record_not_found', details: null, hint: null },
    } as never)
    renderEdit()
    await retitle(user, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument()
  })
})
