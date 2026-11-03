import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { FormTextareaField } from '@/components/shared/form-textarea-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { slugify } from '@/features/workspaces/lib/slug'

import { useCreateModule } from '../api/use-create-module'
import { getModuleErrorMessage } from '../lib/module-errors'
import { uniqueModuleName } from '../lib/module-names'
import {
  BLANK_TEMPLATE_ID,
  getTemplate,
  type ApplyTemplateResult,
  type ModuleTemplate,
} from '../lib/templates'
import { createModuleSchema, type CreateModuleInput } from '../schemas/module'
import { TemplatePicker } from './TemplatePicker'

interface CreateModuleFormProps {
  workspaceId: string
  /** Existing modules, used to suffix a template name that is already taken (B6). */
  existingModules: readonly { name: string; slug: string }[]
  defaultTemplateId?: string
  onCreated: (result: ApplyTemplateResult) => void
  onCancel?: () => void
  autoFocus?: boolean
}

function nameFor(
  template: ModuleTemplate | undefined,
  existing: CreateModuleFormProps['existingModules'],
) {
  if (!template || template.id === BLANK_TEMPLATE_ID) return ''
  return uniqueModuleName(template.name, existing)
}

/**
 * Template + name + slug + description. The name follows the chosen template
 * and the slug follows the name until the user edits them (same rule as
 * `CreateWorkspaceForm`); from then on they are theirs.
 */
export function CreateModuleForm({
  workspaceId,
  existingModules,
  defaultTemplateId = BLANK_TEMPLATE_ID,
  onCreated,
  onCancel,
  autoFocus,
}: CreateModuleFormProps) {
  const createModule = useCreateModule(workspaceId)
  const nameEdited = useRef(false)
  const slugEdited = useRef(false)
  const initialTemplate = getTemplate(defaultTemplateId)
  const initialName = nameFor(initialTemplate, existingModules)
  const form = useForm<CreateModuleInput>({
    resolver: zodResolver(createModuleSchema),
    defaultValues: {
      name: initialName,
      slug: slugify(initialName),
      description: '',
      templateId: initialTemplate?.id ?? BLANK_TEMPLATE_ID,
    },
  })

  const templateId = useWatch({ control: form.control, name: 'templateId' })
  useEffect(() => {
    if (nameEdited.current) return
    const derived = nameFor(getTemplate(templateId), existingModules)
    if (derived !== form.getValues('name')) {
      form.setValue('name', derived, { shouldValidate: form.formState.isSubmitted })
    }
  }, [existingModules, form, templateId])

  const name = useWatch({ control: form.control, name: 'name' })
  useEffect(() => {
    if (slugEdited.current) return
    const derived = slugify(name ?? '')
    if (derived !== form.getValues('slug')) {
      form.setValue('slug', derived, { shouldValidate: form.formState.isSubmitted })
    }
  }, [form, name])

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const template = getTemplate(values.templateId)
      const result = await createModule.mutateAsync({
        name: values.name,
        slug: values.slug,
        description: values.description === '' ? null : values.description,
        icon: template?.icon ?? null,
        templateId: values.templateId,
      })
      onCreated(result)
    } catch {
      // Rendered from `createModule.error`.
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Create module" className="flex flex-col gap-5">
      <FieldGroup>
        <TemplatePicker control={form.control} disabled={createModule.isPending} />
        <div
          onInput={() => {
            nameEdited.current = true
          }}
        >
          <FormTextField
            control={form.control}
            name="name"
            label="Module name"
            placeholder="Housekeeping tasks"
            autoComplete="off"
            autoFocus={autoFocus}
          />
        </div>
        <div
          onInput={() => {
            slugEdited.current = true
          }}
        >
          <FormTextField
            control={form.control}
            name="slug"
            label="Slug"
            placeholder="housekeeping-tasks"
            autoComplete="off"
            description="Used in links and exports. Lowercase letters, numbers and hyphens only."
          />
        </div>
        <FormTextareaField
          control={form.control}
          name="description"
          label="Description (optional)"
          placeholder="What this module tracks and who uses it."
          maxLength={500}
        />
      </FieldGroup>
      <FormServerError
        message={createModule.error ? getModuleErrorMessage(createModule.error) : null}
      />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <SubmitButton pending={createModule.isPending} pendingLabel="Creating...">
          Create module
        </SubmitButton>
      </div>
    </form>
  )
}
