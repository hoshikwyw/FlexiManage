import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { AuditEventWithActor } from '../types'
import { workspaceKeys } from './keys'

export const DEFAULT_AUDIT_LIMIT = 10

export async function fetchAuditEvents(
  workspaceId: string,
  limit: number,
): Promise<AuditEventWithActor[]> {
  // RLS: `audit_events_select_member`. `actor_id` references auth.users, not
  // profiles, so PostgREST cannot embed the actor; load the visible profiles
  // in a second query (RLS shows profiles of users who share a workspace).
  const { data: events, error } = await supabase
    .from('audit_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error

  const actorIds = [...new Set(events.map((e) => e.actor_id).filter((id): id is string => !!id))]
  const actors = new Map<string, AuditEventWithActor['actor']>()
  if (actorIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', actorIds)
    if (profilesError) throw profilesError
    for (const profile of profiles) actors.set(profile.id, profile)
  }

  return events.map((event) => ({
    ...event,
    actor: event.actor_id ? (actors.get(event.actor_id) ?? null) : null,
  }))
}

/** Latest audit events of a workspace with the actor's profile when visible. */
export function useAuditEvents(
  workspaceId: string | null | undefined,
  limit = DEFAULT_AUDIT_LIMIT,
) {
  return useQuery({
    queryKey: workspaceKeys.audit(workspaceId ?? '', limit),
    queryFn: () => fetchAuditEvents(workspaceId!, limit),
    enabled: typeof workspaceId === 'string' && workspaceId.length > 0,
  })
}
