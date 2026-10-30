import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { WorkspaceMembership } from '../types'
import { workspaceKeys } from './keys'

export async function fetchWorkspaces(userId: string): Promise<WorkspaceMembership[]> {
  // RLS (`workspace_members_select_member`) already limits the rows to the
  // caller's memberships; the explicit filter keeps the query cheap and
  // documents the intent. `workspaces` embeds through the FK on workspace_id.
  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, created_at, workspace:workspaces(*)')
    .eq('user_id', userId)
  if (error) throw error

  return data
    .filter((row) => row.workspace !== null)
    .map((row) => ({ workspace: row.workspace, role: row.role, joinedAt: row.created_at }))
    .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name))
}

/** Every workspace the user belongs to, with their role. Disabled until the user id is known. */
export function useWorkspaces(userId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.list(userId ?? ''),
    queryFn: () => fetchWorkspaces(userId!),
    enabled: userId !== undefined,
  })
}
