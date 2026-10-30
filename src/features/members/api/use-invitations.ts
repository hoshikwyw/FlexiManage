import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { Invitation } from '@/types/database'

import { memberKeys } from './keys'

/** Columns the UI needs. The token is never selected: it is only sent to the invitee. */
export type PendingInvitation = Omit<Invitation, 'token'>

export async function fetchInvitations(workspaceId: string): Promise<PendingInvitation[]> {
  // RLS: `invitations_select_owner_admin`; members get zero rows, not an error.
  const { data, error } = await supabase
    .from('invitations')
    .select('id, workspace_id, email, role, invited_by, expires_at, accepted_at, created_at')
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export function isInvitationExpired(invitation: PendingInvitation, now = Date.now()): boolean {
  return new Date(invitation.expires_at).getTime() <= now
}

/**
 * Pending (not yet accepted) invitations of a workspace. Pass `enabled: false`
 * for plain members: RLS would return an empty list anyway and the page hides
 * the section.
 */
export function useInvitations(
  workspaceId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: memberKeys.invitations(workspaceId ?? ''),
    queryFn: () => fetchInvitations(workspaceId!),
    enabled: enabled && typeof workspaceId === 'string' && workspaceId.length > 0,
  })
}
