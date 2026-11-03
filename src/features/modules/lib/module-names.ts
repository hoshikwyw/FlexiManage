import { slugify } from '@/features/workspaces/lib/slug'

/**
 * B6: when a template's module name already exists in the workspace, the
 * prefilled name gets a numeric suffix ("Housekeeping tasks (2)"), and the user
 * may still rename it. Comparison is by slug, which is what the database keeps
 * unique, and case-insensitive by name as the story requests.
 */
export function uniqueModuleName(
  name: string,
  existing: readonly { name: string; slug: string }[],
): string {
  const taken = (candidate: string) => {
    const slug = slugify(candidate)
    const lower = candidate.trim().toLowerCase()
    return existing.some((m) => m.slug === slug || m.name.trim().toLowerCase() === lower)
  }
  if (!taken(name)) return name
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name} (${n})`
    if (!taken(candidate)) return candidate
  }
  return `${name} (${Date.now()})`
}
