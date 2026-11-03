import { useId } from 'react'
import { useController, type Control } from 'react-hook-form'

import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field'
import { getFieldTypeDefinition } from '@/features/records/fields/registry'
import { cn } from '@/lib/utils'

import { MODULE_TEMPLATES, type ModuleTemplate } from '../lib/templates'
import type { CreateModuleInput } from '../schemas/module'

interface TemplatePickerProps {
  control: Control<CreateModuleInput>
  disabled?: boolean
}

/**
 * Radio group over the shipped templates with a read-only preview of each
 * template's fields (B6). Native radios keep it keyboard and screen-reader
 * friendly without extra wiring.
 */
export function TemplatePicker({ control, disabled }: TemplatePickerProps) {
  const groupId = useId()
  const { field, fieldState } = useController({ control, name: 'templateId' })

  return (
    <FieldSet aria-describedby={`${groupId}-hint`}>
      <FieldLegend variant="label">Template</FieldLegend>
      <FieldDescription id={`${groupId}-hint`}>
        Templates only prefill the fields; you can change everything afterwards.
      </FieldDescription>
      <div className="flex flex-col gap-2">
        {MODULE_TEMPLATES.map((template) => (
          <TemplateOption
            key={template.id}
            template={template}
            name={field.name}
            checked={field.value === template.id}
            disabled={disabled}
            onChange={() => field.onChange(template.id)}
            onBlur={field.onBlur}
          />
        ))}
      </div>
      <FieldError errors={[fieldState.error]} />
    </FieldSet>
  )
}

function TemplateOption({
  template,
  name,
  checked,
  disabled,
  onChange,
  onBlur,
}: {
  template: ModuleTemplate
  name: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  onBlur: () => void
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'has-[:focus-visible]:ring-ring/50 flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-3',
        checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={template.id}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        onBlur={onBlur}
        className="accent-primary mt-0.5 size-4 shrink-0"
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{template.id === 'blank' ? 'Blank' : template.name}</span>
        <span className="text-muted-foreground">{template.description}</span>
        {template.fields.length > 0 ? (
          <ul
            className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs"
            aria-label={`Fields of ${template.name}`}
          >
            {template.fields.map((templateField) => (
              <li key={templateField.key}>
                {templateField.label}
                <span className="opacity-70">
                  {' '}
                  · {getFieldTypeDefinition(templateField.type).label.toLowerCase()}
                  {templateField.required ? ' · required' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </label>
  )
}
