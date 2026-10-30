/**
 * Remembers the last selected workspace per user in localStorage so a reload
 * (or a visit to `/`) lands on the same workspace. Keyed by user id so two
 * accounts on one browser never read each other's choice.
 */
const PREFIX = 'fleximanage.currentWorkspace.'

function storageKey(userId: string): string {
  return `${PREFIX}${userId}`
}

export function readStoredWorkspaceId(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

export function writeStoredWorkspaceId(userId: string, workspaceId: string | null): void {
  try {
    if (workspaceId === null) window.localStorage.removeItem(storageKey(userId))
    else window.localStorage.setItem(storageKey(userId), workspaceId)
  } catch {
    // Storage unavailable (private mode, quota): the choice is simply not remembered.
  }
}
