import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { ZodType } from 'zod'

import type { FieldDefinition, FieldType } from '@/types/database'

/**
 * Props every registry input receives. Inputs are controlled and framework
 * agnostic: they emit the *stored* value (what `custom_values` holds: a string,
 * a number, a boolean, a `YYYY-MM-DD` string, or null for "no value"), never a
 * raw DOM string. `RecordFieldControl` wires them to React Hook Form.
 */
export interface FieldInputProps {
  id: string
  field: FieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
}

/**
 * How the records toolbar filters a field type (see `lib/records-query.ts`):
 * text contains, numeric range, date range, one-or-more options, yes/no.
 */
export type FieldFilterKind = 'text' | 'number-range' | 'date-range' | 'options' | 'boolean'

export interface FieldTypeDefinition {
  type: FieldType
  /** Human label ("Text", "Currency"). */
  label: string
  /** Short description shown in the field type picker. */
  description: string
  icon: LucideIcon
  /** Value a new record starts with for this type. */
  defaultValue: unknown
  /**
   * Zod schema for the stored value of one field. `required` makes it
   * non-optional and non-empty; otherwise null and undefined are accepted.
   */
  zodSchema: (field: FieldDefinition) => ZodType
  /** Table cell text; empty string for null/undefined. */
  formatValue: (value: unknown, field: FieldDefinition) => string
  /** Filter offered for the type in the records toolbar and applied server-side. */
  filterKind: FieldFilterKind
  /** Raw input string to stored value (where the two differ). */
  parseInput?: (raw: string, field: FieldDefinition) => unknown
  InputComponent: ComponentType<FieldInputProps>
}
