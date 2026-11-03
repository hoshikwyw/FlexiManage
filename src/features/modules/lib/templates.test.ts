import { describe, expect, it, vi } from 'vitest'

import { createTestField, createTestModule } from '@/test/fields'

import { isValidFieldKey } from './field-key'
import {
  BLANK_TEMPLATE,
  CLIENTS_TEMPLATE,
  HOUSEKEEPING_TASKS_TEMPLATE,
  MODULE_TEMPLATES,
  applyTemplate,
  getTemplate,
  type ModuleWriter,
} from './templates'

describe('module templates', () => {
  it('ships Blank first, then the D1 default, and resolves ids', () => {
    expect(MODULE_TEMPLATES[0]).toBe(BLANK_TEMPLATE)
    expect(MODULE_TEMPLATES[1]).toBe(HOUSEKEEPING_TASKS_TEMPLATE)
    expect(BLANK_TEMPLATE.fields).toEqual([])
    expect(getTemplate('housekeeping-tasks')).toBe(HOUSEKEEPING_TASKS_TEMPLATE)
    expect(getTemplate('nope')).toBeUndefined()
  })

  it('housekeeping has the 8 fields from the D1 spec with the right types and required flags', () => {
    expect(
      HOUSEKEEPING_TASKS_TEMPLATE.fields.map((f) => [f.key, f.type, f.required ?? false]),
    ).toEqual([
      ['room', 'select', true],
      ['due_date', 'date', true],
      ['task_type', 'select', true],
      ['status', 'select', true],
      ['assigned_to', 'text', false],
      ['guests_arriving', 'number', false],
      ['notes', 'text', false],
      ['inspected', 'checkbox', false],
    ])
    const byKey = new Map(HOUSEKEEPING_TASKS_TEMPLATE.fields.map((f) => [f.key, f]))
    expect(byKey.get('room')?.options?.map((o) => o.label)).toEqual([
      'Room 1',
      'Room 2',
      'Room 3',
      'Room 4',
      'Room 5',
      'Room 6',
    ])
    expect(byKey.get('task_type')?.options?.map((o) => o.value)).toEqual([
      'checkout_clean',
      'stayover_refresh',
      'deep_clean',
      'maintenance_check',
    ])
    expect(byKey.get('status')?.options?.map((o) => o.label)).toEqual([
      'To do',
      'In progress',
      'Done',
    ])
  })

  it('uses database-valid keys, distinct option values and a 1..100 option count everywhere', () => {
    for (const template of MODULE_TEMPLATES) {
      const keys = template.fields.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const field of template.fields) {
        expect(isValidFieldKey(field.key)).toBe(true)
        if (field.type === 'select') {
          const values = field.options?.map((o) => o.value) ?? []
          expect(values.length).toBeGreaterThan(0)
          expect(values.length).toBeLessThanOrEqual(100)
          expect(new Set(values).size).toBe(values.length)
        } else {
          expect(field.options).toBeUndefined()
        }
      }
    }
    expect(CLIENTS_TEMPLATE.fields.map((f) => f.key)).toEqual([
      'company',
      'contact_email',
      'status',
      'value',
    ])
  })
})

function fakeWriter(overrides: Partial<ModuleWriter> = {}): ModuleWriter {
  return {
    createModule: vi.fn(async (input) => createTestModule({ id: 'mod-1', ...input })),
    createField: vi.fn(async (input) =>
      createTestField({
        id: `fld-${input.key}`,
        module_id: input.moduleId,
        key: input.key,
        label: input.label,
        type: input.type,
        required: input.required,
        position: input.position,
      }),
    ),
    deleteModule: vi.fn(async () => undefined),
    ...overrides,
  }
}

const moduleInput = { name: 'Rooms', slug: 'rooms', description: null, icon: 'bed-double' }

describe('applyTemplate', () => {
  it('creates the module, then every field in order with ascending positions', async () => {
    const writer = fakeWriter()
    const result = await applyTemplate(writer, HOUSEKEEPING_TASKS_TEMPLATE, moduleInput)

    expect(writer.createModule).toHaveBeenCalledWith(moduleInput)
    expect(writer.createField).toHaveBeenCalledTimes(8)
    const calls = vi.mocked(writer.createField).mock.calls.map(([input]) => input)
    expect(calls.map((c) => c.key)).toEqual(HOUSEKEEPING_TASKS_TEMPLATE.fields.map((f) => f.key))
    expect(calls.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(calls.every((c) => c.moduleId === 'mod-1')).toBe(true)
    expect(calls[0]?.options).toHaveLength(6)
    expect(calls[4]?.options).toEqual([])
    expect(calls[5]?.settings).toEqual({ precision: 0 })
    expect(result.module.id).toBe('mod-1')
    expect(result.fields.map((f) => f.key)).toEqual(calls.map((c) => c.key))
    expect(writer.deleteModule).not.toHaveBeenCalled()
  })

  it('creates only the module for the blank template', async () => {
    const writer = fakeWriter()
    const result = await applyTemplate(writer, BLANK_TEMPLATE, moduleInput)
    expect(writer.createField).not.toHaveBeenCalled()
    expect(result.fields).toEqual([])
  })

  it('deletes the module again when a field insert fails and rethrows the original error', async () => {
    const failure = Object.assign(new Error('boom'), { code: '23514' })
    const writer = fakeWriter({
      createField: vi.fn().mockResolvedValueOnce(createTestField()).mockRejectedValueOnce(failure),
    })
    await expect(applyTemplate(writer, HOUSEKEEPING_TASKS_TEMPLATE, moduleInput)).rejects.toBe(
      failure,
    )
    expect(writer.createField).toHaveBeenCalledTimes(2)
    expect(writer.deleteModule).toHaveBeenCalledWith('mod-1')
  })

  it('still surfaces the field error when the cleanup itself fails', async () => {
    const failure = new Error('field failed')
    const writer = fakeWriter({
      createField: vi.fn().mockRejectedValue(failure),
      deleteModule: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    })
    await expect(applyTemplate(writer, CLIENTS_TEMPLATE, moduleInput)).rejects.toBe(failure)
    expect(writer.deleteModule).toHaveBeenCalledTimes(1)
  })
})
