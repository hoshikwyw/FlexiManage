import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createClientsFields, TEST_MODULE_ID, TEST_WORKSPACE_ID } from '@/test/fields'
import { renderWithProviders } from '@/test/render'

import type { RecordItem, RecordSort } from '../types'
import { RecordsTable } from './RecordsTable'

function createRecord(overrides: Partial<RecordItem>): RecordItem {
  return {
    id: 'r1',
    workspace_id: TEST_WORKSPACE_ID,
    module_id: TEST_MODULE_ID,
    title: 'Acme Ltd',
    status: null,
    custom_values: {},
    created_by: null,
    created_at: '2026-11-03T10:00:00.000Z',
    updated_at: '2026-11-03T10:00:00.000Z',
    ...overrides,
  }
}

const rows = [
  createRecord({
    id: 'r1',
    title: 'Acme Ltd',
    custom_values: { company: 'Acme Ltd', status: 'active', value: 1234.5 },
  }),
  createRecord({ id: 'r2', title: 'Globex', custom_values: { company: 'Globex', status: 'gone' } }),
]

function renderTable(sort: RecordSort = { by: 'updated_at', dir: 'desc' }) {
  const onSort = vi.fn()
  const onOpen = vi.fn()
  renderWithProviders(
    <RecordsTable
      fields={createClientsFields()}
      rows={rows}
      sort={sort}
      onSort={onSort}
      onOpen={onOpen}
      recordHref={(id) => `/records/${id}`}
    />,
  )
  return { onSort, onOpen }
}

describe('RecordsTable', () => {
  it('renders title, fields in order and updated, formatting values through the registry', () => {
    renderTable()
    const table = screen.getByRole('table', { name: 'Records' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Title', 'Company', 'Contact email', 'Status', 'Contract value', 'Updated'])
    const [, acme, globex] = within(table).getAllByRole('row')
    expect(acme).toHaveTextContent('Active')
    expect(acme).toHaveTextContent(/€|EUR/)
    expect(globex).toHaveTextContent('gone (removed option)')
  })

  it('marks the sorted column with aria-sort and the others with none', () => {
    renderTable({ by: 'f.value', dir: 'asc' })
    const headers = screen.getAllByRole('columnheader')
    expect(headers[4]).toHaveAttribute('aria-sort', 'ascending')
    expect(headers[0]).toHaveAttribute('aria-sort', 'none')
    expect(headers[5]).toHaveAttribute('aria-sort', 'none')
  })

  it('reports the sort target of a clicked header', async () => {
    const user = userEvent.setup()
    const { onSort } = renderTable()
    await user.click(screen.getByRole('button', { name: 'Title' }))
    await user.click(screen.getByRole('button', { name: 'Status' }))
    await user.click(screen.getByRole('button', { name: 'Updated' }))
    expect(onSort.mock.calls).toEqual([['title'], ['f.status'], ['updated_at']])
  })

  it('opens a record on row click and on Enter from the focused row', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderTable()
    const [, acme, globex] = screen.getAllByRole('row')
    await user.click(within(globex!).getByText('Globex', { selector: 'td' }))
    expect(onOpen).toHaveBeenLastCalledWith('r2')
    acme!.focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenLastCalledWith('r1')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
