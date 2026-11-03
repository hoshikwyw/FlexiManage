import { z } from 'zod'

import { FIELD_TYPES } from '@/types/database'

import { CURRENCY_CODES } from '../lib/currencies'
import { FIELD_KEY_PATTERN } from '../lib/field-key'

export const FIELD_LABEL_MAX_LENGTH = 100
export const OPTION_TEXT_MAX_LENGTH = 100
export const MAX_SELECT_OPTIONS = 100
export const MIN_PRECISION = 0
export const MAX_PRECISION = 6

export const fieldLabelSchema = z
  .string()
  .trim()
  .min(1, { error: 'Label is required' })
  .max(FIELD_LABEL_MAX_LENGTH, {
    error: `Label must be ${FIELD_LABEL_MAX_LENGTH} characters or fewer`,
  })

export const fieldKeySchema = z
  .string()
  .trim()
  .min(1, { error: 'Key is required' })
  .regex(FIELD_KEY_PATTERN, {
    error: 'Start with a lowercase letter; use lowercase letters, digits and underscores (max 50)',
  })

export const fieldTypeSchema = z.enum(FIELD_TYPES, { error: 'Choose a field type' })

const optionText = (what: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Option ${what} is required` })
    .max(OPTION_TEXT_MAX_LENGTH, {
      error: `Option ${what} must be ${OPTION_TEXT_MAX_LENGTH} characters or fewer`,
    })

export const selectOptionSchema = z.object({
  value: optionText('value'),
  label: optionText('label'),
})
export type SelectOptionInput = z.infer<typeof selectOptionSchema>

/** 1..100 options with distinct values (`field_definitions_options_check`). */
export const selectOptionsSchema = z
  .array(selectOptionSchema)
  .min(1, { error: 'Add at least one option' })
  .max(MAX_SELECT_OPTIONS, { error: `Use at most ${MAX_SELECT_OPTIONS} options` })
  .superRefine((options, ctx) => {
    const seen = new Map<string, number>()
    options.forEach((option, index) => {
      const first = seen.get(option.value)
      if (first === undefined) {
        seen.set(option.value, index)
        return
      }
      ctx.addIssue({
        code: 'custom',
        path: [index, 'value'],
        message: `Duplicate of option ${first + 1}; option values must be distinct`,
      })
    })
  })

export const precisionSchema = z
  .number({ error: 'Enter a whole number from 0 to 6' })
  .int({ error: 'Precision must be a whole number' })
  .min(MIN_PRECISION, { error: 'Precision must be at least 0' })
  .max(MAX_PRECISION, { error: `Precision must be at most ${MAX_PRECISION}` })

export const currencyCodeSchema = z.enum(CURRENCY_CODES, { error: 'Choose a currency' })

/**
 * One flat form for every field type. Type-specific parts (`options`,
 * `settings`) are validated only when the type uses them; `toFieldPayload`
 * strips the rest so the database constraints (`options` must be `[]` for
 * non-select types) hold.
 */
export const fieldFormSchema = z
  .object({
    label: fieldLabelSchema,
    key: fieldKeySchema,
    type: fieldTypeSchema,
    required: z.boolean(),
    options: z.array(selectOptionSchema),
    settings: z.object({
      currency: z.union([z.literal(''), currencyCodeSchema]),
      /** '' means "not set" (number fields may leave precision open). */
      precision: z.union([z.literal(''), precisionSchema]),
    }),
  })
  .superRefine((values, ctx) => {
    if (values.type === 'select') {
      const result = selectOptionsSchema.safeParse(values.options)
      for (const issue of result.error?.issues ?? []) {
        ctx.addIssue({ ...issue, path: ['options', ...issue.path] })
      }
    }
    if (values.type === 'currency' && values.settings.currency === '') {
      ctx.addIssue({ code: 'custom', path: ['settings', 'currency'], message: 'Choose a currency' })
    }
  })
export type FieldFormInput = z.infer<typeof fieldFormSchema>
