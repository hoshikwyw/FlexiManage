import { z } from 'zod'

import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../lib/slug'

export const WORKSPACE_NAME_MAX_LENGTH = 100

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Workspace name is required' })
  .max(WORKSPACE_NAME_MAX_LENGTH, {
    error: `Workspace name must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer`,
  })

export const workspaceSlugSchema = z
  .string()
  .trim()
  .min(1, { error: 'Slug is required' })
  .max(SLUG_MAX_LENGTH, { error: `Slug must be ${SLUG_MAX_LENGTH} characters or fewer` })
  .regex(SLUG_PATTERN, {
    error: 'Use lowercase letters, numbers and single hyphens (no leading or trailing hyphen)',
  })

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  slug: workspaceSlugSchema,
})
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>

export const updateWorkspaceSchema = createWorkspaceSchema
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
