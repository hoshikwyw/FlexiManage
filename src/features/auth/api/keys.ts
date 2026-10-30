/** Query keys for the auth feature. Everything lives under `['auth', ...]`. */
export const authKeys = {
  all: ['auth'] as const,
  session: ['auth', 'session'] as const,
  callback: (code: string) => ['auth', 'callback', code] as const,
}

/** Predicate for clearing every cached query that belongs to a user, keeping auth state. */
export function isUserScopedQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] !== authKeys.all[0]
}
