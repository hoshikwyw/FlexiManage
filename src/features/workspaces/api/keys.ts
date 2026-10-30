/** Query keys for the workspaces feature. Lists are per user, details and audit per workspace. */
export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: (userId: string) => ['workspaces', userId] as const,
  detail: (workspaceId: string) => ['workspace', workspaceId] as const,
  auditAll: (workspaceId: string) => ['audit', workspaceId] as const,
  audit: (workspaceId: string, limit: number) => ['audit', workspaceId, { limit }] as const,
}
