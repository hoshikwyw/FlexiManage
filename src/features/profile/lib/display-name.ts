import type { Profile } from '@/types/database'

type NameSource = Pick<Profile, 'full_name' | 'email'> | null | undefined

/** Full name when set, otherwise the email, otherwise a neutral fallback. */
export function getDisplayName(profile: NameSource, fallbackEmail?: string | null): string {
  const name = profile?.full_name?.trim()
  if (name) return name
  return profile?.email ?? fallbackEmail ?? 'Account'
}

/**
 * Up to two initials for an avatar fallback: "Ada Lovelace" -> "AL",
 * "ada@x.io" -> "A", "ada.lovelace@x.io" -> "AL". For an email only the local
 * part (before `@`) is used so the domain never contributes a letter.
 */
export function getInitials(name: string): string {
  const source = name.includes('@') ? (name.split('@')[0] ?? '') : name
  const parts = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join('')
  return initials || '?'
}
