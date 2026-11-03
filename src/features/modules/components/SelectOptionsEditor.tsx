import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useMemo } from 'react'
import { useController, useFieldArray, useFormContext } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { SelectOption } from '@/types/database'

import { deriveOptionValue } from '../lib/field-key'
import type { FieldFormInput } from '../schemas/field'

interface SelectOptionsEditorProps {
  /** Options the field had when the dialog opened; their values stay fixed so records keep matching. */
  initialOptions: readonly SelectOption[]
  disabled?: boolean
}

/**
 * Add, relabel, reorder and remove the options of a select field. Each option
 * stores a stable `value` (what records hold) and a `label` (what people see).
 * New options derive their value from the label; options that already existed
 * keep theirs, so renaming "Lead" to "Prospect" leaves records valid (B1).
 */
export function SelectOptionsEditor({ initialOptions, disabled }: SelectOptionsEditorProps) {
  const { control, setValue, getValues } = useFormContext<FieldFormInput>()
  const { fields, append, remove, move } = useFieldArray({ control, name: 'options' })
  const { fieldState } = useController({ control, name: 'options' })
  const lockedValues = useMemo(
    () => new Set(initialOptions.map((option) => option.value)),
    [initialOptions],
  )

  function handleLabelChange(index: number, label: string) {
    setValue(`options.${index}.label`, label, { shouldDirty: true })
    const current = getValues(`options.${index}.value`)
    if (!lockedValues.has(current)) {
      setValue(`options.${index}.value`, deriveOptionValue(label), { shouldDirty: true })
    }
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">Options</FieldLegend>
      <FieldDescription>
        People pick one of these. The value in grey is what records store; it is fixed once saved,
        the label can change any time.
      </FieldDescription>
      {fields.length === 0 ? (
        <p className="text-muted-foreground text-sm">No options yet.</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Select options">
          {fields.map((item, index) => (
            <OptionRow
              key={item.id}
              index={index}
              total={fields.length}
              disabled={disabled}
              onLabelChange={(label) => handleLabelChange(index, label)}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
      )}
      <FieldError errors={[fieldState.error]} />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => append({ value: '', label: '' }, { shouldFocus: true })}
        >
          <PlusIcon aria-hidden="true" />
          Add option
        </Button>
      </div>
    </FieldSet>
  )
}

function OptionRow({
  index,
  total,
  disabled,
  onLabelChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number
  total: number
  disabled?: boolean
  onLabelChange: (label: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const { control } = useFormContext<FieldFormInput>()
  const label = useController({ control, name: `options.${index}.label` })
  const value = useController({ control, name: `options.${index}.value` })
  const error = label.fieldState.error ?? value.fieldState.error
  const errorId = `option-${index}-error`
  const n = index + 1

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Option ${n} label`}
          placeholder={`Option ${n}`}
          value={label.field.value}
          onChange={(event) => onLabelChange(event.target.value)}
          onBlur={label.field.onBlur}
          disabled={disabled}
          maxLength={100}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex-1"
        />
        <code
          className="text-muted-foreground w-28 truncate text-xs"
          aria-label={`Option ${n} value`}
          title={value.field.value}
        >
          {value.field.value || '—'}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move option ${n} up`}
          disabled={disabled || index === 0}
          onClick={onMoveUp}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move option ${n} down`}
          disabled={disabled || index === total - 1}
          onClick={onMoveDown}
        >
          <ArrowDownIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          aria-label={`Remove option ${n}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      <FieldError id={errorId} errors={[error]} />
    </li>
  )
}
