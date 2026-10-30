import { NETWORK_ERROR_MESSAGE, isNetworkError, isPostgrestError } from '@/lib/postgrest-errors'

export const SLUG_TAKEN_MESSAGE = 'This slug is already taken. Choose another one.'
export const WORKSPACE_NOT_FOUND_MESSAGE =
  'Workspace not found or you are not allowed to change it.'
export const GENERIC_WORKSPACE_ERROR_MESSAGE = 'The workspace could not be saved. Please try again.'

/**
 * Thrown by the workspace hooks when a write affected zero rows: RLS hid the
 * row (insufficient role) or it no longer exists. Postgres reports no error for
 * that case, so the hook detects it from the returned rows.
 */
export class WorkspaceNotFoundError extends Error {
  constructor() {
    super(WORKSPACE_NOT_FOUND_MESSAGE)
    this.name = 'WorkspaceNotFoundError'
  }
}

/** Friendly messages for workspace create, update and delete failures. */
export function getWorkspaceErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceNotFoundError) return error.message
  if (isPostgrestError(error)) {
    switch (error.code) {
      case '23505': // unique_violation: workspaces.slug
        return SLUG_TAKEN_MESSAGE
      case '23514': // check_violation: slug pattern or name length
        return 'Use 1 to 100 characters for the name and lowercase letters, numbers and single hyphens for the slug.'
      case '42501': // insufficient_privilege (RLS or column grant)
        return 'You are not allowed to change this workspace.'
      case 'PGRST116': // zero rows: RLS hid the row or it does not exist
        return WORKSPACE_NOT_FOUND_MESSAGE
      default:
        return GENERIC_WORKSPACE_ERROR_MESSAGE
    }
  }
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE
  return GENERIC_WORKSPACE_ERROR_MESSAGE
}
