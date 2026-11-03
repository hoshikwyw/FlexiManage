import type { RecordsQuery } from '../types'

/**
 * Query keys for records; every key starts with `['records', workspaceId]`.
 * Invalidating `module(ws, moduleId)` refreshes that module's lists and
 * details; `counts(ws)` holds the per-module record counts.
 */
export const recordKeys = {
  workspace: (workspaceId: string) => ['records', workspaceId] as const,
  module: (workspaceId: string, moduleId: string) => ['records', workspaceId, moduleId] as const,
  lists: (workspaceId: string, moduleId: string) =>
    ['records', workspaceId, moduleId, 'list'] as const,
  list: (workspaceId: string, moduleId: string, query: RecordsQuery | null) =>
    ['records', workspaceId, moduleId, 'list', query] as const,
  detail: (workspaceId: string, moduleId: string, recordId: string) =>
    ['records', workspaceId, moduleId, 'detail', recordId] as const,
  counts: (workspaceId: string) => ['records', workspaceId, 'counts'] as const,
}
