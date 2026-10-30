import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { FieldGroup } from '@/components/ui/field'

import { useSignIn } from '../api/use-sign-in'
import { getAuthErrorMessage } from '../lib/auth-errors'
import { AUTH_ROUTES } from '../lib/auth-redirects'
import { signInSchema, type SignInInput } from '../schemas/auth'

interface SignInFormProps {
  onSuccess?: () => void
}

export function SignInForm({ onSuccess }: SignInFormProps) {
  const signIn = useSignIn()
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signIn.mutateAsync(values)
      onSuccess?.()
    } catch {
      // Error state is rendered from `signIn.error`; keep the form editable.
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Sign in" className="flex flex-col gap-5">
      <FieldGroup>
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
          autoComplete="current-password"
        />
      </FieldGroup>
      <FormServerError message={signIn.error ? getAuthErrorMessage(signIn.error) : null} />
      <SubmitButton pending={signIn.isPending} pendingLabel="Signing in..." className="w-full">
        Sign in
      </SubmitButton>
      <p className="text-muted-foreground text-center text-sm">
        <Link
          to={AUTH_ROUTES.forgotPassword}
          className="hover:text-foreground underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  )
}
