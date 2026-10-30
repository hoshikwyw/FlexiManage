import { z } from 'zod'
import { AppError } from './errors.ts'

/**
 * Parses the JSON body with a Zod schema. Throws 400 `validation_error` with the
 * flattened issues (`formErrors`, `fieldErrors`) in `details`.
 */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.output<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new AppError(400, 'validation_error', 'Request body must be valid JSON')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new AppError(
      400,
      'validation_error',
      'Invalid request body',
      z.flattenError(result.error),
    )
  }
  return result.data
}
