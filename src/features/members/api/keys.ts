/** Query keys for the members feature, all scoped by workspace id. */
export const memberKeys = {
  members: (workspaceId: string) => ['members', workspaceId] as const,
  invitations: (workspaceId: string) => ['invitations', workspaceId] as const,
  /** One-shot acceptance keyed by token so StrictMode cannot redeem it twice. */
  accept: (token: string) => ['invitations', 'accept', token] as const,
}
