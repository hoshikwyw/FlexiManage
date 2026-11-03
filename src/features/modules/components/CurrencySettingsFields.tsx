import { useId } from 'react'
import { useController, useFormContext } from 'react-hook-form'

import { FormSelectField } from '@/components/shared/form-select-field'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import { CURRENCY_CODES } from '../lib/currencies'
import { MAX_PRECISION, MIN_PRECISION, type FieldFormInput } from '../schemas/field'

/** Currency code (currency fields) and decimal precision (number and currency fields). */
export function CurrencySettingsFields({ showCurrency }: { showCurrency: boolean }) {
  const { control } = useFormContext<FieldFormInput>()
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const precision = useController({ control, name: 'settings.precision' })
  const invalid = precision.fieldState.error !== undefined

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {showCurrency ? (
        <FormSelectField
          control={control}
          name="settings.currency"
          label="Currency"
          options={[
            { value: '', label: 'Choose...' },
            ...CURRENCY_CODES.map((code) => ({ value: code, label: code })),
          ]}
        />
      ) : null}
      <Field data-invalid={invalid || undefined}>
        <FieldLabel htmlFor={id}>Decimal places</FieldLabel>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_PRECISION}
          max={MAX_PRECISION}
          step={1}
          value={precision.field.value === '' ? '' : String(precision.field.value)}
          onChange={(event) => {
            const raw = event.target.value
            precision.field.onChange(raw === '' ? '' : Number(raw))
          }}
          onBlur={precision.field.onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        />
        <FieldDescription id={hintId}>
          0 to 6. {showCurrency ? 'Most currencies use 2.' : 'Leave empty for any precision.'}
        </FieldDescription>
        <FieldError id={errorId} errors={[precision.fieldState.error]} />
      </Field>
    </div>
  )
}
