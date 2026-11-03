import { FilterIcon, SearchIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FIELD_TYPE_REGISTRY } from '@/features/records/fields/registry'
import type { FieldDefinition } from '@/types/database'

import { describeFilter } from '../lib/filter-labels'
import { SEARCH_MAX_LENGTH } from '../lib/records-query'
import type { RecordFilter } from '../types'
import { FILTER_CONTROLS } from './filters'

interface RecordsToolbarProps {
  fields: readonly FieldDefinition[]
  /** Text in the search box (applied by the caller after a debounce). */
  search: string
  onSearchChange: (value: string) => void
  filters: readonly RecordFilter[]
  onFilterChange: (key: string, filter: RecordFilter | null) => void
  /** Clears search and every filter. */
  onClearAll: () => void
}

/**
 * Search box, an inline filter row built from the field definitions (one
 * control per field, chosen by the registry's `filterKind`), active filter
 * chips and "Clear all".
 */
export function RecordsToolbar({
  fields,
  search,
  onSearchChange,
  filters,
  onFilterChange,
  onClearAll,
}: RecordsToolbarProps) {
  const searchId = useId()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const active = filters.filter((filter) => byKey.has(filter.key))
  const hasCriteria = active.length > 0 || search.trim() !== ''

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search records
          </label>
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            placeholder="Search records"
            className="pl-8"
            value={search}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        {fields.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <FilterIcon aria-hidden="true" />
            Filters
            {active.length > 0 ? (
              <Badge variant="secondary">
                {active.length}
                <span className="sr-only"> active</span>
              </Badge>
            ) : null}
          </Button>
        ) : null}
        {hasCriteria ? (
          <Button type="button" variant="ghost" onClick={onClearAll}>
            Clear all
          </Button>
        ) : null}
      </div>

      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label="Filters"
          className="bg-muted/30 grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {fields.map((field) => {
            const Control = FILTER_CONTROLS[FIELD_TYPE_REGISTRY[field.type].filterKind]
            return (
              <Control
                key={field.id}
                field={field}
                filter={active.find((filter) => filter.key === field.key)}
                onChange={(filter) => onFilterChange(field.key, filter)}
              />
            )
          })}
        </div>
      ) : null}

      {active.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Active filters">
          {active.map((filter) => {
            const field = byKey.get(filter.key)
            if (!field) return null
            const text = describeFilter(filter, field)
            return (
              <li key={filter.key}>
                <span className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-xs">
                  {text}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove filter ${text}`}
                    onClick={() => onFilterChange(filter.key, null)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
