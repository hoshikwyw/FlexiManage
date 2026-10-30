import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'

import { useRequestPasswordReset } from '../api/use-request-password-reset'
import { getAuthErrorMessage } from '../lib/auth-errors'
import { requestPasswordResetSchema, type RequestPasswordResetInput } from '../schemas/auth'

interface ForgotPasswordFormProps {
  onSuccess?: (values: RequestPasswordResetInput) => void
}

export function ForgotPasswordForm({ onSuccess }: ForgotPasswordFormProps) {
  const request = useRequestPasswordReset()
  const form = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await request.mutateAsync(values)
      onSuccess?.(values)
    } catch {
      // Rendered from `request.error`.
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Reset password"
      className="flex flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
      </FieldGroup>
      <FormServerError message={request.error ? getAuthErrorMessage(request.error) : null} />
      <SubmitButton pending={request.isPending} pendingLabel="Sending..." className="w-full">
        Send reset link
      </SubmitButton>
    </form>
  )
}
