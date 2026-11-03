import { z } from 'zod'

import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '@/features/workspaces/lib/slug'

import { MODULE_ICONS } from '../lib/module-icons'
import { MODULE_TEMPLATES } from '../lib/templates'

export const MODULE_NAME_MAX_LENGTH = 100
export const MODULE_DESCRIPTION_MAX_LENGTH = 500

export const moduleNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Module name is required' })
  .max(MODULE_NAME_MAX_LENGTH, {
    error: `Module name must be ${MODULE_NAME_MAX_LENGTH} characters or fewer`,
  })

/** Same shape as workspace slugs: `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..60 (`modules.slug` check). */
export const moduleSlugSchema = z
  .string()
  .trim()
  .min(1, { error: 'Slug is required' })
  .max(SLUG_MAX_LENGTH, { error: `Slug must be ${SLUG_MAX_LENGTH} characters or fewer` })
  .regex(SLUG_PATTERN, {
    error: 'Use lowercase letters, numbers and single hyphens (no leading or trailing hyphen)',
  })

export const moduleDescriptionSchema = z
  .string()
  .trim()
  .max(MODULE_DESCRIPTION_MAX_LENGTH, {
    error: `Description must be ${MODULE_DESCRIPTION_MAX_LENGTH} characters or fewer`,
  })

/** '' means "no icon"; stored as null. */
export const moduleIconSchema = z.union([z.literal(''), z.enum(MODULE_ICONS)])

const templateIds = MODULE_TEMPLATES.map((template) => template.id)

export const createModuleSchema = z.object({
  name: moduleNameSchema,
  slug: moduleSlugSchema,
  description: moduleDescriptionSchema,
  templateId: z.string().refine((id) => templateIds.includes(id), { error: 'Choose a template' }),
})
export type CreateModuleInput = z.infer<typeof createModuleSchema>

export const updateModuleSchema = z.object({
  name: moduleNameSchema,
  slug: moduleSlugSchema,
  description: moduleDescriptionSchema,
  icon: moduleIconSchema,
})
export type UpdateModuleInput = z.infer<typeof updateModuleSchema>
