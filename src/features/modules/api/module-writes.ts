import { toOptionsJson } from '@/features/records/fields/field-json'
import { supabase } from '@/lib/supabase'
import type { FieldDefinition, Module } from '@/types/database'

import { FieldNotFoundError, ModuleNotFoundError } from '../lib/module-errors'
import type { ModuleWriter, NewFieldInput, NewModuleInput } from '../lib/templates'

/**
 * The raw statements behind the module and field mutations. Kept apart from
 * the hooks so `applyTemplate` (plain TypeScript) can run them in sequence and
 * so a backend API can replace them without touching the UI.
 *
 * RLS: `modules_select_member` lets the creator read the row back, so unlike
 * workspaces the insert can `.select()` directly. Insert and update policies
 * require `has_workspace_role(owner, admin)`; a member gets `42501`.
 */

export async function countModules(workspaceId: string): Promise<number> {
  const { count, error } = await supabase
    .from('modules')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  if (error) throw error
  return count ?? 0
}

export async function insertModule(
  workspaceId: string,
  input: NewModuleInput,
  position: number,
): Promise<Module> {
  const { data, error } = await supabase
    .from('modules')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      icon: input.icon,
      position,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function insertField(
  workspaceId: string,
  input: NewFieldInput,
): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from('field_definitions')
    .insert({
      workspace_id: workspaceId,
      module_id: input.moduleId,
      key: input.key,
      label: input.label,
      type: input.type,
      required: input.required,
      position: input.position,
      options: toOptionsJson(input.options),
      settings: { ...input.settings },
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** Deletes a module (fields and records cascade). Zero rows means RLS hid it or it is gone. */
export async function deleteModuleRow(workspaceId: string, moduleId: string): Promise<void> {
  const { data, error } = await supabase
    .from('modules')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', moduleId)
    .select('id')
  if (error) throw error
  if (data.length === 0) throw new ModuleNotFoundError()
}

/** Deletes a field; `handle_field_deleted()` strips its key from the module's records. */
export async function deleteFieldRow(workspaceId: string, fieldId: string): Promise<void> {
  const { data, error } = await supabase
    .from('field_definitions')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', fieldId)
    .select('id')
  if (error) throw error
  if (data.length === 0) throw new FieldNotFoundError()
}

/** `ModuleWriter` bound to one workspace, for `applyTemplate`. */
export function createModuleWriter(workspaceId: string, position: number): ModuleWriter {
  return {
    createModule: (input) => insertModule(workspaceId, input, position),
    createField: (input) => insertField(workspaceId, input),
    deleteModule: (moduleId) => deleteModuleRow(workspaceId, moduleId),
  }
}
