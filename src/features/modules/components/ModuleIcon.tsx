import { createElement } from 'react'

import { getModuleIcon } from '../lib/module-icons'

/**
 * Decorative lucide icon for a module's stored icon name (folder when unset or
 * unknown). The lookup returns a stateless icon component, so rendering it via
 * `createElement` is safe; the indirection only keeps the static-components
 * lint rule from reading the lookup as a component created during render.
 */
export function ModuleIcon({ name, className }: { name: string | null; className?: string }) {
  return createElement(getModuleIcon(name), { className, 'aria-hidden': true })
}
