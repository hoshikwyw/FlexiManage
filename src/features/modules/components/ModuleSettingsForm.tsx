import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormSelectField } from '@/components/shared/form-select-field'
import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { FormTextareaField } from '@/components/shared/form-textarea-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'
import type { Module } from '@/types/database'

import { useUpdateModule } from '../api/use-update-module'
import { getModuleFormErrorMessage } from '../lib/module-errors'
import { MODULE_ICONS, MODULE_ICON_LABELS, isModuleIconName } from '../lib/module-icons'
import { updateModuleSchema, type UpdateModuleInput } from '../schemas/module'
import { setModuleFieldError } from './set-module-field-error'

interface ModuleSettingsFormProps {
  workspaceId: string
  module: Module
  /** Members can look but not edit; RLS would reject the update anyway. */
  readOnly?: boolean
}

function toForm(module: Module): UpdateModuleInput {
  return {
    name: module.name,
    slug: module.slug,
    description: module.description ?? '',
    icon: isModuleIconName(module.icon) ? module.icon : '',
  }
}

/** Rename a module, change its slug, description or icon (owner/admin). */
export function ModuleSettingsForm({ workspaceId, module, readOnly }: ModuleSettingsFormProps) {
  const updateModule = useUpdateModule(workspaceId, module.id)
  const form = useForm<UpdateModuleInput>({
    resolver: zodResolver(updateModuleSchema),
    defaultValues: toForm(module),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await updateModule.mutateAsync({
        name: values.name,
        slug: values.slug,
        description: values.description === '' ? null : values.description,
        icon: values.icon === '' ? null : values.icon,
      })
      form.reset(toForm(saved))
      toast.success('Module updated')
    } catch (error) {
      // A duplicate slug or name goes on its input; anything else is rendered from `updateModule.error`.
      setModuleFieldError(form.setError, error)
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Module settings"
      className="flex max-w-md flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="name"
          label="Module name"
          autoComplete="off"
          disabled={readOnly}
        />
        <FormTextField
          control={form.control}
          name="slug"
          label="Slug"
          autoComplete="off"
          disabled={readOnly}
          description="Used in links and export file names. Lowercase letters, numbers and hyphens only."
        />
        <FormTextareaField
          control={form.control}
          name="description"
          label="Description"
          disabled={readOnly}
          maxLength={500}
        />
        <FormSelectField
          control={form.control}
          name="icon"
          label="Icon"
          disabled={readOnly}
          options={[
            { value: '', label: 'None' },
            ...MODULE_ICONS.map((icon) => ({ value: icon, label: MODULE_ICON_LABELS[icon] })),
          ]}
        />
      </FieldGroup>
      <FormServerError message={getModuleFormErrorMessage(updateModule.error)} />
      {readOnly ? (
        <p className="text-muted-foreground text-sm">Only owners and admins can change modules.</p>
      ) : (
        <div>
          <SubmitButton
            pending={updateModule.isPending}
            pendingLabel="Saving..."
            disabled={!form.formState.isDirty}
          >
            Save changes
          </SubmitButton>
        </div>
      )}
    </form>
  )
}
