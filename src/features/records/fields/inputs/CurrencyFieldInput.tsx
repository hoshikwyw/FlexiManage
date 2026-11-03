import { getFieldSettings } from '../field-json'
import type { FieldInputProps } from '../types'
import { NumberFieldInput } from './NumberFieldInput'

/** Number input with the ISO currency code shown as a suffix. */
export function CurrencyFieldInput(props: FieldInputProps) {
  const { currency } = getFieldSettings(props.field)
  return (
    <div className="flex items-center gap-2">
      <NumberFieldInput {...props} />
      {currency ? (
        <span className="text-muted-foreground shrink-0 text-sm" aria-hidden="true">
          {currency}
        </span>
      ) : null}
    </div>
  )
}
