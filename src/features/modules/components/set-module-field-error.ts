import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { moduleFieldError } from '../lib/module-errors'

/**
 * Puts a duplicate module slug or name (23505) on its input and focuses it.
 * Returns false when the error is not one of those (the form shows it as a
 * form-level message instead).
 */
export function setModuleFieldError<T extends FieldValues & { name: string; slug: string }>(
  setError: UseFormSetError<T>,
  error: unknown,
): boolean {
  const fieldError = moduleFieldError(error)
  if (!fieldError) return false
  setError(
    fieldError.field as Path<T>,
    { type: 'server', message: fieldError.message },
    { shouldFocus: true },
  )
  return true
}
