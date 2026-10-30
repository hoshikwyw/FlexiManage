import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { Member } from '../types'
import { memberKeys } from './keys'

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 } as const

export async function fetchMembers(workspaceId: string): Promise<Member[]> {
  // RLS: `workspace_members_select_member`. `user_id` references auth.users,
  // not profiles, so the profiles are loaded in a second query; RLS
  // (`profiles_select_self_or_shared_workspace`) shows every co-member.
  const { data: rows, error } = await supabase
    .from('workspace_members')
    .select('*')
    .eq('workspace_id', workspaceId)
  if (error) throw error

  const profiles = new Map<string, Member['profile']>()
  if (rows.length > 0) {
    const { data, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url')
      .in(
        'id',
        rows.map((row) => row.user_id),
      )
    if (profilesError) throw profilesError
    for (const profile of data) profiles.set(profile.id, profile)
  }

  return rows
    .map((row) => ({ ...row, profile: profiles.get(row.user_id) ?? null }))
    .sort((a, b) => {
      const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
      if (byRole !== 0) return byRole
      const nameA = a.profile?.full_name ?? a.profile?.email ?? ''
      const nameB = b.profile?.full_name ?? b.profile?.email ?? ''
      return nameA.localeCompare(nameB)
    })
}

/** Members of a workspace with their profiles, owners first. */
export function useMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: memberKeys.members(workspaceId ?? ''),
    queryFn: () => fetchMembers(workspaceId!),
    enabled: typeof workspaceId === 'string' && workspaceId.length > 0,
  })
}
