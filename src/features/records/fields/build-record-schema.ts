import { z, type ZodObject, type ZodType } from 'zod'

import type { FieldDefinition } from '@/types/database'

import { FIELD_TYPE_REGISTRY } from './registry'

export type CustomValues = Record<string, unknown>

/**
 * Zod object for `records.custom_values` built from the module's field
 * definitions: one property per field key, validated by the registry entry of
 * its type. Strict, so a key without a definition fails client-side exactly
 * like `custom_values.<key>: unknown field` does on the server.
 */
export function buildRecordSchema(
  fields: readonly FieldDefinition[],
): ZodObject<Record<string, ZodType>> {
  const shape: Record<string, ZodType> = {}
  for (const field of fields) {
    shape[field.key] = FIELD_TYPE_REGISTRY[field.type].zodSchema(field)
  }
  return z.strictObject(shape)
}

/** Default `custom_values` for a new record: each field's registry default. */
export function buildDefaultValues(fields: readonly FieldDefinition[]): CustomValues {
  const values: CustomValues = {}
  for (const field of fields) {
    values[field.key] = FIELD_TYPE_REGISTRY[field.type].defaultValue
  }
  return values
}
