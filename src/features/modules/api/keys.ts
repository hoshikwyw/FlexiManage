/** Query keys for the modules feature; every key starts with the workspace id after its scope word. */
export const moduleKeys = {
  list: (workspaceId: string) => ['modules', workspaceId] as const,
  detail: (workspaceId: string, moduleId: string) => ['module', workspaceId, moduleId] as const,
  fields: (workspaceId: string, moduleId: string) => ['fields', workspaceId, moduleId] as const,
  usage: (workspaceId: string) => ['usage', workspaceId] as const,
}
