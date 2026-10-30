import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { supabase } from '@/lib/supabase'
import type { Workspace } from '@/types/database'

import type { CreateWorkspaceInput } from '../schemas/workspace'
import { workspaceKeys } from './keys'

/**
 * Inserts a workspace with `created_by = auth.uid()` (required by RLS
 * `workspaces_insert_creator`). The `on_workspace_created` trigger adds the
 * owner membership and the `workspace.created` audit row in the same
 * transaction; Phase 4 moves this behind the `create-workspace` function once
 * plan limits must be checked first.
 *
 * The insert deliberately has no `RETURNING`: Postgres applies the SELECT
 * policy (`is_workspace_member`) to returned rows, and the AFTER trigger that
 * makes the creator a member has not run yet at that point, so
 * `insert().select()` fails with 42501. The row is read back by slug (unique)
 * once the trigger has committed the membership.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useMutation({
    mutationFn: async ({ name, slug }: CreateWorkspaceInput): Promise<Workspace> => {
      if (!user) throw new Error('You must be signed in to create a workspace.')
      const { error } = await supabase
        .from('workspaces')
        .insert({ name, slug, created_by: user.id })
      if (error) throw error
      const { data, error: readError } = await supabase
        .from('workspaces')
        .select('*')
        .eq('slug', slug)
        .single()
      if (readError) throw readError
      return data
    },
    onSuccess: async () => {
      if (!user) return
      // Await so the caller can navigate to the new workspace once the list contains it.
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(user.id) })
    },
  })
}
