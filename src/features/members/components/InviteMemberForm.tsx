import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormSelectField } from '@/components/shared/form-select-field'
import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { getRoleLabel } from '@/lib/workspace-roles'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'
import type { WorkspaceRole } from '@/types/database'

import { useInviteMember } from '../api/use-invite-member'
import { getMemberErrorMessage } from '../lib/member-errors'
import { invitableRoles } from '../lib/member-permissions'
import { inviteMemberSchema, type InviteMemberInput } from '../schemas/invite'

interface InviteMemberFormProps {
  workspaceId: string
  /** The caller's role decides which roles can be granted (owner: all; admin: admin, member). */
  callerRole: WorkspaceRole
}

/** Email + role form calling the `invite-member` Edge Function. */
export function InviteMemberForm({ workspaceId, callerRole }: InviteMemberFormProps) {
  const inviteMember = useInviteMember(workspaceId)
  const roles = invitableRoles(callerRole)
  const form = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '', role: 'member' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const invitation = await inviteMember.mutateAsync(values)
      form.reset({ email: '', role: values.role })
      toast.success(`Invitation sent to ${invitation.email}`)
    } catch {
      // Rendered from `inviteMember.error`.
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Invite member" className="flex flex-col gap-5">
      <FieldGroup className="sm:flex-row sm:items-start">
        <FormTextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          placeholder="colleague@example.com"
        />
        <FormSelectField
          control={form.control}
          name="role"
          label="Role"
          options={roles.map((role) => ({ value: role, label: getRoleLabel(role) }))}
        />
      </FieldGroup>
      <FormServerError
        message={inviteMember.error ? getMemberErrorMessage(inviteMember.error) : null}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          An email with the invite link will be sent. Invitations expire after 7 days.
        </p>
        <SubmitButton pending={inviteMember.isPending} pendingLabel="Sending...">
          Send invitation
        </SubmitButton>
      </div>
    </form>
  )
}
