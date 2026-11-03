import type {
  FieldDefinition,
  FieldSettings,
  FieldType,
  Module,
  SelectOption,
} from '@/types/database'

import type { ModuleIconName } from './module-icons'

/**
 * Module templates (Epic B6) shipped as versioned code. Applying one creates a
 * module and its fields through the same path as a manual create; the result
 * has no link back to the template. Changing a template therefore never alters
 * existing modules; bump `version` when the shape changes so analytics can tell
 * them apart.
 */

export interface TemplateField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: SelectOption[]
  settings?: FieldSettings
}

export interface ModuleTemplate {
  id: string
  version: number
  name: string
  description: string
  icon: ModuleIconName | null
  fields: TemplateField[]
}

export const BLANK_TEMPLATE_ID = 'blank'

function selectOptions(labels: string[]): SelectOption[] {
  return labels.map((label) => ({
    value: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, ''),
    label,
  }))
}

export const BLANK_TEMPLATE: ModuleTemplate = {
  id: BLANK_TEMPLATE_ID,
  version: 1,
  name: 'New module',
  description: 'An empty module. Add fields yourself afterwards.',
  icon: 'folder',
  fields: [],
}

/** The D1 default (docs/product/segment-comparison.md); only this entry changes if D1 lands elsewhere. */
export const HOUSEKEEPING_TASKS_TEMPLATE: ModuleTemplate = {
  id: 'housekeeping-tasks',
  version: 1,
  name: 'Housekeeping tasks',
  description: 'Cleaning and maintenance tasks per room for a small lodging business.',
  icon: 'bed-double',
  fields: [
    {
      key: 'room',
      label: 'Room',
      type: 'select',
      required: true,
      options: selectOptions(['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6']),
    },
    { key: 'due_date', label: 'Due date', type: 'date', required: true },
    {
      key: 'task_type',
      label: 'Task type',
      type: 'select',
      required: true,
      options: selectOptions([
        'Checkout clean',
        'Stayover refresh',
        'Deep clean',
        'Maintenance check',
      ]),
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      options: selectOptions(['To do', 'In progress', 'Done']),
    },
    { key: 'assigned_to', label: 'Assigned to', type: 'text' },
    {
      key: 'guests_arriving',
      label: 'Guests arriving',
      type: 'number',
      settings: { precision: 0 },
    },
    { key: 'notes', label: 'Notes', type: 'text' },
    { key: 'inspected', label: 'Inspected', type: 'checkbox' },
  ],
}

/** Mirrors the seed module of Workspace A (`supabase/seed.sql`). */
export const CLIENTS_TEMPLATE: ModuleTemplate = {
  id: 'clients',
  version: 1,
  name: 'Clients',
  description: 'Companies you work with, their contact and contract value.',
  icon: 'building-2',
  fields: [
    { key: 'company', label: 'Company', type: 'text', required: true },
    { key: 'contact_email', label: 'Contact email', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: selectOptions(['Lead', 'Active', 'Churned']),
    },
    {
      key: 'value',
      label: 'Contract value',
      type: 'currency',
      settings: { currency: 'EUR', precision: 2 },
    },
  ],
}

/** Blank first, then the D1 default, then the extras. */
export const MODULE_TEMPLATES: readonly ModuleTemplate[] = [
  BLANK_TEMPLATE,
  HOUSEKEEPING_TASKS_TEMPLATE,
  CLIENTS_TEMPLATE,
]

export const DEFAULT_TEMPLATE_ID = HOUSEKEEPING_TASKS_TEMPLATE.id

export function getTemplate(id: string): ModuleTemplate | undefined {
  return MODULE_TEMPLATES.find((template) => template.id === id)
}

export interface NewModuleInput {
  name: string
  slug: string
  description: string | null
  icon: string | null
}

export interface NewFieldInput {
  moduleId: string
  key: string
  label: string
  type: FieldType
  required: boolean
  position: number
  options: SelectOption[]
  settings: FieldSettings
}

/** The three writes `applyTemplate` needs; the hook binds them to Supabase, tests to fakes. */
export interface ModuleWriter {
  createModule: (input: NewModuleInput) => Promise<Module>
  createField: (input: NewFieldInput) => Promise<FieldDefinition>
  deleteModule: (moduleId: string) => Promise<void>
}

export interface ApplyTemplateResult {
  module: Module
  fields: FieldDefinition[]
}

/**
 * Creates the module, then its fields in template order. PostgREST offers no
 * transaction, so if a field insert fails the module is deleted again
 * (best effort; its fields cascade) and the original error is rethrown. The
 * database writes `module.created` and `field.created` audit rows; the client
 * adds none.
 */
export async function applyTemplate(
  writer: ModuleWriter,
  template: ModuleTemplate,
  module: NewModuleInput,
): Promise<ApplyTemplateResult> {
  const created = await writer.createModule(module)
  const fields: FieldDefinition[] = []
  try {
    for (const [position, field] of template.fields.entries()) {
      fields.push(
        await writer.createField({
          moduleId: created.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required ?? false,
          position,
          options: field.options ?? [],
          settings: field.settings ?? {},
        }),
      )
    }
  } catch (error) {
    await writer.deleteModule(created.id).catch(() => undefined)
    throw error
  }
  return { module: created, fields }
}
