/** Query keys for attachments; scoped by workspace, then record. */
export const attachmentKeys = {
  workspace: (workspaceId: string) => ['attachments', workspaceId] as const,
  record: (workspaceId: string, recordId: string) =>
    ['attachments', workspaceId, recordId] as const,
}
