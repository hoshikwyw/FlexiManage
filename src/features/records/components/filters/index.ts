import type { ComponentType } from 'react'

import type { FieldFilterKind } from '@/features/records/fields/types'

import { BooleanFilterControl, OptionsFilterControl } from './ChoiceFilterControls'
import type { FilterControlProps } from './filter-control-types'
import { DateRangeFilterControl, NumberRangeFilterControl } from './RangeFilterControl'
import { TextFilterControl } from './TextFilterControl'

/**
 * Filter control per registry `filterKind`: the toolbar asks the registry for
 * a field's kind and renders the matching control, never switching on
 * `field.type` itself.
 */
export const FILTER_CONTROLS: Record<FieldFilterKind, ComponentType<FilterControlProps>> = {
  text: TextFilterControl,
  options: OptionsFilterControl,
  boolean: BooleanFilterControl,
  'number-range': NumberRangeFilterControl,
  'date-range': DateRangeFilterControl,
}

export type { FilterControlProps }
