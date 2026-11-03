import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toOptionsJson } from '@/features/records/fields/field-json'
import { supabase } from '@/lib/supabase'
import type { FieldDefinition, FieldSettings, SelectOption } from '@/types/database'

import { moduleKeys } from './keys'

export interface UpdateFieldVariables {
  fieldId: string
  label: string
  required: boolean
  options: SelectOption[]
  settings: FieldSettings
}

/**
 * Updates label, required flag, options and settings. `key` and `type` are
 * deliberately absent: the key is immutable (`field_definitions.key: cannot be
 * changed`) and the type is frozen while records hold a value, so the UI never
 * offers either after creation. `protect_field_definition()` also rejects
 * removing an option that records still use; the error is mapped in
 * `module-errors.ts`.
 */
export function useUpdateField(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ fieldId, ...input }: UpdateFieldVariables): Promise<FieldDefinition> => {
      const { data, error } = await supabase
        .from('field_definitions')
        .update({
          label: input.label,
          required: input.required,
          options: toOptionsJson(input.options),
          settings: { ...input.settings },
        })
        .eq('workspace_id', workspaceId)
        .eq('id', fieldId)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: moduleKeys.fields(workspaceId, moduleId) })
    },
  })
}
