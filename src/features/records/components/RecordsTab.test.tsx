import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation, useNavigate } from 'react-router-dom'

import { useFieldDefinitions } from '@/features/modules/api/use-field-definitions'
import { createClientsFields, TEST_MODULE_ID, TEST_WORKSPACE_ID } from '@/test/fields'
import { renderWithProviders } from '@/test/render'

import { useRecords } from '../api/use-records'
import type { RecordsPage } from '../types'
import { RecordsTab } from './RecordsTab'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})
vi.mock('@/features/modules/api/use-field-definitions', () => ({ useFieldDefinitions: vi.fn() }))
vi.mock('../api/use-records', () => ({ useRecords: vi.fn() }))

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <button type="button" onClick={() => void navigate({ search: '?q=globex' })}>
        Go to globex
      </button>
    </>
  )
}

function mockRecords(page: RecordsPage) {
  vi.mocked(useRecords).mockReturnValue({
    data: page,
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useRecords>)
}

function renderTab(search = '') {
  return renderWithProviders(
    <>
      <RecordsTab workspaceId={TEST_WORKSPACE_ID} moduleId={TEST_MODULE_ID} />
      <LocationProbe />
    </>,
    { initialEntries: [`/w/${TEST_WORKSPACE_ID}/modules/${TEST_MODULE_ID}${search}`] },
  )
}

const location = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '')

describe('RecordsTab', () => {
  beforeEach(() => {
    vi.mocked(useFieldDefinitions).mockReturnValue({
      data: createClientsFields(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFieldDefinitions>)
  })

  it('shows "No records yet" with a create link when the module is empty', () => {
    mockRecords({ rows: [], total: 0 })
    renderTab()
    expect(screen.getByRole('heading', { name: 'No records yet' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No records match' })).not.toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'New record' })
    expect(links[links.length - 1]).toHaveAttribute(
      'href',
      `/w/${TEST_WORKSPACE_ID}/modules/${TEST_MODULE_ID}/records/new`,
    )
  })

  it('shows "No records match" when filters are active and clears them', async () => {
    const user = userEvent.setup()
    mockRecords({ rows: [], total: 0 })
    renderTab('?f.status=lead&q=zz&sort=title&dir=asc&page=2')
    expect(screen.getByRole('heading', { name: 'No records match' })).toBeInTheDocument()
    expect(screen.getByText('Status: Lead')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    await waitFor(() => expect(location().toString()).toBe('sort=title&dir=asc'))
    expect(screen.getByLabelText('Search records')).toHaveValue('')
  })

  it('passes the parsed URL state to useRecords', () => {
    mockRecords({ rows: [], total: 0 })
    renderTab('?q=acme&size=50&f.value=100..&sort=f.value&dir=desc&f.nope=1')
    expect(vi.mocked(useRecords)).toHaveBeenLastCalledWith(TEST_WORKSPACE_ID, TEST_MODULE_ID, {
      page: 1,
      pageSize: 50,
      search: 'acme',
      sort: { by: 'f.value', dir: 'desc' },
      filters: [{ kind: 'number-range', key: 'value', min: 100, max: null }],
    })
  })

  it('debounces the search into the URL and resets the page', async () => {
    const user = userEvent.setup()
    mockRecords({ rows: [], total: 40 })
    renderTab('?page=2')
    await user.type(screen.getByLabelText('Search records'), 'glob')
    expect(location().get('q')).toBeNull()
    await waitFor(() => expect(location().get('q')).toBe('glob'))
    expect(location().get('page')).toBeNull()
  })

  it('keeps a trailing space in the box when the trimmed term reaches the URL', async () => {
    const user = userEvent.setup()
    mockRecords({ rows: [], total: 40 })
    renderTab()
    const box = screen.getByLabelText('Search records')
    await user.type(box, 'acme ')
    await waitFor(() => expect(location().get('q')).toBe('acme'))
    expect(box).toHaveValue('acme ')
    await user.type(box, 'ltd')
    expect(box).toHaveValue('acme ltd')
    await waitFor(() => expect(location().get('q')).toBe('acme ltd'))
    expect(box).toHaveValue('acme ltd')
  })

  it('still replaces the box when the URL search changes to another term', async () => {
    const user = userEvent.setup()
    mockRecords({ rows: [], total: 0 })
    renderTab('?q=acme')
    const box = screen.getByLabelText('Search records')
    expect(box).toHaveValue('acme')
    // Back/forward or a shared link: the URL now means another search.
    await user.click(screen.getByRole('button', { name: 'Go to globex' }))
    await waitFor(() => expect(box).toHaveValue('globex'))
  })

  it('applies a select filter from the filter row and resets the page', async () => {
    const user = userEvent.setup()
    mockRecords({ rows: [], total: 40 })
    renderTab('?page=3')
    await user.click(screen.getByRole('button', { name: /Filters/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Lead' }))
    await waitFor(() => expect(location().getAll('f.status')).toEqual(['lead']))
    expect(location().get('page')).toBeNull()
    const toggle = screen.getByRole('button', { name: /^Filters/ })
    expect(toggle.textContent?.replace(/\s+/g, ' ').trim()).toBe('Filters1 active')
  })
})

describe('RecordsTab export button', () => {
  beforeEach(() => {
    vi.mocked(useFieldDefinitions).mockReturnValue({
      data: createClientsFields(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFieldDefinitions>)
  })

  function renderWithRole(role: 'owner' | 'admin' | 'member' | null) {
    return renderWithProviders(
      <RecordsTab
        workspaceId={TEST_WORKSPACE_ID}
        moduleId={TEST_MODULE_ID}
        moduleSlug="clients"
        role={role}
      />,
      { initialEntries: [`/w/${TEST_WORKSPACE_ID}/modules/${TEST_MODULE_ID}`] },
    )
  }

  it('is hidden from members and when no role is passed', () => {
    mockRecords({ rows: [], total: 3 })
    renderWithRole('member')
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
  })

  it('is disabled for an owner while the table shows zero rows', () => {
    mockRecords({ rows: [], total: 0 })
    renderWithRole('owner')
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('is enabled for an admin when rows match', () => {
    mockRecords({ rows: [], total: 3, outOfRange: true })
    renderWithRole('admin')
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  })
})
