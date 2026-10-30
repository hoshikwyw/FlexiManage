import type { Profile } from '@/types/database'

type NameSource = Pick<Profile, 'full_name' | 'email'> | null | undefined

/** Full name when set, otherwise the email, otherwise a neutral fallback. */
export function getDisplayName(profile: NameSource, fallbackEmail?: string | null): string {
  const name = profile?.full_name?.trim()
  if (name) return name
  return profile?.email ?? fallbackEmail ?? 'Account'
}

/** Up to two initials for an avatar fallback ("Ada Lovelace" -> "AL", "ada@x.io" -> "A"). */
export function getInitials(name: string): string {
  const parts = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join('')
  return initials || '?'
}
