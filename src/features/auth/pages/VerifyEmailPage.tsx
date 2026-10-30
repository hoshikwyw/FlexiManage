import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { FormServerError } from '@/components/shared/form-server-error'
import { Button } from '@/components/ui/button'

import { useResendConfirmation } from '../api/use-resend-confirmation'
import { AuthCard } from '../components/AuthCard'
import { LocalInboxHint } from '../components/LocalInboxHint'
import { getAuthErrorMessage } from '../lib/auth-errors'
import { AUTH_ROUTES } from '../lib/auth-redirects'

/** Shown after sign-up when the project requires email confirmation. */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email')
  const resend = useResendConfirmation()

  return (
    <AuthCard
      title="Check your inbox"
      description={
        email
          ? `We sent a confirmation link to ${email}. Open it to activate your account.`
          : 'We sent you a confirmation link. Open it to activate your account.'
      }
      footer={
        <Link to={AUTH_ROUTES.signIn} className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <LocalInboxHint />
        <FormServerError message={resend.error ? getAuthErrorMessage(resend.error) : null} />
        {email ? (
          <Button
            type="button"
            variant="outline"
            disabled={resend.isPending}
            aria-busy={resend.isPending || undefined}
            onClick={() => {
              resend.mutate(
                { email },
                { onSuccess: () => toast.success('Confirmation email sent again') },
              )
            }}
          >
            {resend.isPending ? 'Sending...' : 'Resend confirmation email'}
          </Button>
        ) : null}
      </div>
    </AuthCard>
  )
}
