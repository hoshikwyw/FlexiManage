import { useMutation, useQueryClient } from '@tanstack/react-query'

import { recordKeys } from '@/features/records/api/keys'
import { workspaceKeys } from '@/features/workspaces/api/keys'

import {
  applyTemplate,
  BLANK_TEMPLATE,
  getTemplate,
  type ApplyTemplateResult,
  type NewModuleInput,
} from '../lib/templates'
import { moduleKeys } from './keys'
import { countModules, createModuleWriter } from './module-writes'

export interface CreateModuleVariables extends NewModuleInput {
  /** Template to apply; `blank` (or unknown) creates the module alone. */
  templateId?: string
}

/**
 * Creates a module (position = current count) and, for a template, its fields
 * in order through `applyTemplate`. The `on_module_created` trigger writes the
 * audit row; Phase 4 adds `check_entitlement` in front of the insert without
 * changing this hook. Invalidates the list, `['usage', workspaceId]`, the
 * per-module record counts and the audit feed.
 */
export function useCreateModule(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ templateId, ...input }: CreateModuleVariables) => {
      const template = (templateId && getTemplate(templateId)) || BLANK_TEMPLATE
      const position = await countModules(workspaceId)
      return applyTemplate(createModuleWriter(workspaceId, position), template, input)
    },
    onSuccess: ({ module, fields }: ApplyTemplateResult) => {
      queryClient.setQueryData(moduleKeys.detail(workspaceId, module.id), module)
      queryClient.setQueryData(moduleKeys.fields(workspaceId, module.id), fields)
      void queryClient.invalidateQueries({ queryKey: moduleKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: moduleKeys.usage(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: recordKeys.counts(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
