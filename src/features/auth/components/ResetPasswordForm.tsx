import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'

import { useUpdatePassword } from '../api/use-update-password'
import { getAuthErrorMessage } from '../lib/auth-errors'
import {
  PASSWORD_MIN_LENGTH,
  updatePasswordSchema,
  type UpdatePasswordInput,
} from '../schemas/auth'

interface ResetPasswordFormProps {
  onSuccess?: () => void
}

export function ResetPasswordForm({ onSuccess }: ResetPasswordFormProps) {
  const updatePassword = useUpdatePassword()
  const form = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updatePassword.mutateAsync({ password: values.password })
      onSuccess?.()
    } catch {
      // Rendered from `updatePassword.error`.
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Choose a new password"
      className="flex flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <FormTextField
          control={form.control}
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
        />
      </FieldGroup>
      <FormServerError
        message={updatePassword.error ? getAuthErrorMessage(updatePassword.error) : null}
      />
      <SubmitButton
        pending={updatePassword.isPending}
        pendingLabel="Updating..."
        className="w-full"
      >
        Update password
      </SubmitButton>
    </form>
  )
}
