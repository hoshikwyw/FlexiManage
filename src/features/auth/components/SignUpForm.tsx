import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'

import { useSignUp } from '../api/use-sign-up'
import { getAuthErrorMessage } from '../lib/auth-errors'
import { PASSWORD_MIN_LENGTH, signUpSchema, type SignUpInput } from '../schemas/auth'
import type { SignUpResult } from '../types'

interface SignUpFormProps {
  onSuccess?: (result: SignUpResult, values: SignUpInput) => void
}

export function SignUpForm({ onSuccess }: SignUpFormProps) {
  const signUp = useSignUp()
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await signUp.mutateAsync({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
      })
      onSuccess?.(result, values)
    } catch {
      // Rendered from `signUp.error`.
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Create account"
      className="flex flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="fullName"
          label="Full name"
          autoComplete="name"
          placeholder="Ada Lovelace"
        />
        <FormTextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <FormTextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <FormTextField
          control={form.control}
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
        />
      </FieldGroup>
      <FormServerError message={signUp.error ? getAuthErrorMessage(signUp.error) : null} />
      <SubmitButton
        pending={signUp.isPending}
        pendingLabel="Creating account..."
        className="w-full"
      >
        Create account
      </SubmitButton>
    </form>
  )
}
