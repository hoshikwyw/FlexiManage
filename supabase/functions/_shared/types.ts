/** Mirrors the Postgres enum `public.workspace_role`. */
export type WorkspaceRole = 'owner' | 'admin' | 'member'

export const WORKSPACE_ROLES = [
  'owner',
  'admin',
  'member',
] as const satisfies readonly WorkspaceRole[]
