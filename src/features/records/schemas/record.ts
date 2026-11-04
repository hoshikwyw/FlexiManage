import { z } from 'zod'

import {
  buildDefaultValues,
  buildRecordSchema,
  type CustomValues,
} from '@/features/records/fields/build-record-schema'
import { FIELD_TYPE_REGISTRY } from '@/features/records/fields/registry'
import type { FieldDefinition } from '@/types/database'

import type { RecordItem } from '../types'
import { compactCustomValues, readCustomValues, type RecordPayload } from '../lib/record-values'

/** Mirrors the `records` checks: title 1..200, status null or <= 50. */
export const RECORD_TITLE_MAX = 200
export const RECORD_STATUS_MAX = 50

export interface RecordFormValues {
  title: string
  status: string
  custom_values: CustomValues
}

/**
 * The record form schema: the structured core plus the module's custom values
 * from `buildRecordSchema`, so every field is validated by its registry entry
 * before anything is sent.
 */
export function buildRecordFormSchema(fields: readonly FieldDefinition[]) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, { error: 'Enter a title' })
      .max(RECORD_TITLE_MAX, { error: `Use at most ${RECORD_TITLE_MAX} characters` }),
    status: z
      .string()
      .trim()
      .max(RECORD_STATUS_MAX, { error: `Use at most ${RECORD_STATUS_MAX} characters` }),
    custom_values: buildRecordSchema(fields),
  })
}

/** Starting values of a new record. */
export function emptyRecordFormValues(fields: readonly FieldDefinition[]): RecordFormValues {
  return { title: '', status: '', custom_values: buildDefaultValues(fields) }
}

/**
 * Form values of an existing record: each current field gets the stored value
 * or the registry's `emptyValue` ("no value", never an invented default: a
 * checkbox that was never set stays unset instead of becoming `false`); keys
 * without a definition are left out (the strict schema would reject them and
 * the server strips deleted keys anyway).
 */
export function recordToFormValues(
  record: Pick<RecordItem, 'title' | 'status' | 'custom_values'>,
  fields: readonly FieldDefinition[],
): RecordFormValues {
  const stored = readCustomValues(record.custom_values)
  const custom_values: CustomValues = {}
  for (const field of fields) {
    const value = stored[field.key]
    custom_values[field.key] =
      value === undefined || value === null ? FIELD_TYPE_REGISTRY[field.type].emptyValue : value
  }
  return { title: record.title, status: record.status ?? '', custom_values }
}

/** Parsed form values -> row columns (`status` '' -> null, empty custom values left out). */
export function toRecordPayload(values: RecordFormValues): RecordPayload {
  const status = values.status.trim()
  return {
    title: values.title.trim(),
    status: status === '' ? null : status,
    custom_values: compactCustomValues(values.custom_values),
  }
}

/** Required fields the stored record has no value for (added after it was created). */
export function missingRequiredFields(
  record: Pick<RecordItem, 'custom_values'>,
  fields: readonly FieldDefinition[],
): FieldDefinition[] {
  const stored = readCustomValues(record.custom_values)
  return fields.filter((field) => {
    if (!field.required) return false
    const value = stored[field.key]
    return value === undefined || value === null || value === ''
  })
}
