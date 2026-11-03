import type { FieldDefinition, Module } from '@/types/database'

export const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa'
export const TEST_MODULE_ID = '00000000-0000-0000-0000-0000000a0001'

/** A field definition row with sensible defaults; pass overrides for the case under test. */
export function createTestField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  const key = overrides.key ?? 'company'
  return {
    id: `field-${key}`,
    workspace_id: TEST_WORKSPACE_ID,
    module_id: TEST_MODULE_ID,
    key,
    label: 'Company',
    type: 'text',
    required: false,
    position: 0,
    options: [],
    settings: {},
    created_at: '2026-11-03T00:00:00.000Z',
    updated_at: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }
}

export function createTestModule(overrides: Partial<Module> = {}): Module {
  return {
    id: TEST_MODULE_ID,
    workspace_id: TEST_WORKSPACE_ID,
    name: 'Clients',
    slug: 'clients',
    description: null,
    icon: 'building-2',
    position: 0,
    created_by: '00000000-0000-0000-0000-00000000000a',
    created_at: '2026-11-03T00:00:00.000Z',
    updated_at: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }
}

/** The four seed fields of the Clients module, in position order. */
export function createClientsFields(): FieldDefinition[] {
  return [
    createTestField({
      key: 'company',
      label: 'Company',
      type: 'text',
      required: true,
      position: 0,
    }),
    createTestField({ key: 'contact_email', label: 'Contact email', type: 'text', position: 1 }),
    createTestField({
      key: 'status',
      label: 'Status',
      type: 'select',
      position: 2,
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'active', label: 'Active' },
        { value: 'churned', label: 'Churned' },
      ],
    }),
    createTestField({
      key: 'value',
      label: 'Contract value',
      type: 'currency',
      position: 3,
      settings: { currency: 'EUR', precision: 2 },
    }),
  ]
}
