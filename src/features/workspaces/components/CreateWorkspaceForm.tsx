import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import type { Workspace } from '@/types/database'

import { useCreateWorkspace } from '../api/use-create-workspace'
import { slugify } from '../lib/slug'
import { getWorkspaceErrorMessage } from '../lib/workspace-errors'
import { createWorkspaceSchema, type CreateWorkspaceInput } from '../schemas/workspace'

interface CreateWorkspaceFormProps {
  onCreated: (workspace: Workspace) => void
  onCancel?: () => void
  /** Autofocus the name field (dialogs). */
  autoFocus?: boolean
}

/**
 * Name + slug form. The slug follows the name (`slugify`) until the user edits
 * the slug field; from then on it is theirs. Validation mirrors the database
 * check constraints so most mistakes are caught before a request.
 */
export function CreateWorkspaceForm({ onCreated, onCancel, autoFocus }: CreateWorkspaceFormProps) {
  const createWorkspace = useCreateWorkspace()
  const slugEdited = useRef(false)
  const form = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: '', slug: '' },
  })

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
      const workspace = await createWorkspace.mutateAsync(values)
      onCreated(workspace)
    } catch {
      // Rendered from `createWorkspace.error`.
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Create workspace"
      className="flex flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="name"
          label="Workspace name"
          placeholder="Acme Inc"
          autoComplete="organization"
          autoFocus={autoFocus}
        />
        {/* Any keystroke in the slug field hands the slug over to the user. */}
        <div
          onInput={() => {
            slugEdited.current = true
          }}
        >
          <FormTextField
            control={form.control}
            name="slug"
            label="Slug"
            placeholder="acme-inc"
            autoComplete="off"
            description="Used in links. Lowercase letters, numbers and hyphens only."
          />
        </div>
      </FieldGroup>
      <FormServerError
        message={createWorkspace.error ? getWorkspaceErrorMessage(createWorkspace.error) : null}
      />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <SubmitButton pending={createWorkspace.isPending} pendingLabel="Creating...">
          Create workspace
        </SubmitButton>
      </div>
    </form>
  )
}
