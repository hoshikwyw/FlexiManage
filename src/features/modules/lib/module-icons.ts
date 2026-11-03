import {
  BedDoubleIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ClipboardListIcon,
  FolderIcon,
  HomeIcon,
  PackageIcon,
  TagIcon,
  TruckIcon,
  UsersIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'

/**
 * Curated icons a module may use (`modules.icon`, <= 50 chars). Names are the
 * lucide kebab-case ids so the seed (`building-2`) and the UI agree.
 */
export const MODULE_ICONS = [
  'folder',
  'building-2',
  'users',
  'briefcase',
  'calendar',
  'clipboard-list',
  'package',
  'wrench',
  'home',
  'bed-double',
  'truck',
  'tag',
] as const

export type ModuleIconName = (typeof MODULE_ICONS)[number]

const ICON_COMPONENTS: Record<ModuleIconName, LucideIcon> = {
  folder: FolderIcon,
  'building-2': Building2Icon,
  users: UsersIcon,
  briefcase: BriefcaseIcon,
  calendar: CalendarIcon,
  'clipboard-list': ClipboardListIcon,
  package: PackageIcon,
  wrench: WrenchIcon,
  home: HomeIcon,
  'bed-double': BedDoubleIcon,
  truck: TruckIcon,
  tag: TagIcon,
}

export const MODULE_ICON_LABELS: Record<ModuleIconName, string> = {
  folder: 'Folder',
  'building-2': 'Building',
  users: 'People',
  briefcase: 'Briefcase',
  calendar: 'Calendar',
  'clipboard-list': 'Checklist',
  package: 'Package',
  wrench: 'Wrench',
  home: 'Home',
  'bed-double': 'Bed',
  truck: 'Truck',
  tag: 'Tag',
}

export function isModuleIconName(value: unknown): value is ModuleIconName {
  return typeof value === 'string' && (MODULE_ICONS as readonly string[]).includes(value)
}

/** Component for a stored icon name; unknown or missing names fall back to a folder. */
export function getModuleIcon(name: string | null | undefined): LucideIcon {
  return isModuleIconName(name) ? ICON_COMPONENTS[name] : FolderIcon
}
