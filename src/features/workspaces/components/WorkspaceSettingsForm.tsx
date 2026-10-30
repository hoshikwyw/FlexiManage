import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'
import type { Workspace } from '@/types/database'

import { useUpdateWorkspace } from '../api/use-update-workspace'
import { getWorkspaceErrorMessage } from '../lib/workspace-errors'
import { updateWorkspaceSchema, type UpdateWorkspaceInput } from '../schemas/workspace'

interface WorkspaceSettingsFormProps {
  workspace: Workspace
  /** Members can look but not edit; RLS would reject the update anyway. */
  readOnly?: boolean
}

/** Rename a workspace or change its slug (owner/admin). */
export function WorkspaceSettingsForm({ workspace, readOnly }: WorkspaceSettingsFormProps) {
  const updateWorkspace = useUpdateWorkspace(workspace.id)
  const form = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: { name: workspace.name, slug: workspace.slug },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await updateWorkspace.mutateAsync(values)
      form.reset({ name: saved.name, slug: saved.slug })
      toast.success('Workspace updated')
    } catch {
      // Rendered from `updateWorkspace.error`.
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Workspace settings"
      className="flex max-w-md flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="name"
          label="Workspace name"
          autoComplete="organization"
          disabled={readOnly}
        />
        <FormTextField
          control={form.control}
          name="slug"
          label="Slug"
          autoComplete="off"
          disabled={readOnly}
          description="Used in links. Lowercase letters, numbers and hyphens only."
        />
      </FieldGroup>
      <FormServerError
        message={updateWorkspace.error ? getWorkspaceErrorMessage(updateWorkspace.error) : null}
      />
      {readOnly ? (
        <p className="text-muted-foreground text-sm">
          Only owners and admins can change workspace settings.
        </p>
      ) : (
        <div>
          <SubmitButton
            pending={updateWorkspace.isPending}
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
