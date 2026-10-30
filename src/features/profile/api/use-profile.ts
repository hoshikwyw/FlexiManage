import { useQuery } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/database'

import { profileKeys } from './keys'

export async function fetchProfile(userId: string): Promise<Profile> {
  // RLS: `profiles_select_self_or_shared_workspace` lets a user read their own row.
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

/** The signed-in user's own `profiles` row. Disabled until the session is known. */
export function useProfile() {
  const { user } = useSession()
  const userId = user?.id

  return useQuery({
    queryKey: profileKeys.detail(userId ?? ''),
    queryFn: () => fetchProfile(userId!),
    enabled: userId !== undefined,
  })
}
