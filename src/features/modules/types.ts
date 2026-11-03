import type { Module } from '@/types/database'

/** A module row with the number of field definitions it has (list cards). */
export interface ModuleSummary extends Module {
  fieldCount: number
}
