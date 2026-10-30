/** Query keys for the profile feature: `['profile', userId]`. */
export const profileKeys = {
  all: ['profile'] as const,
  detail: (userId: string) => ['profile', userId] as const,
}
