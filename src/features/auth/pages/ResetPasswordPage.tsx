import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { FullPageSpinner } from '@/components/shared/full-page-spinner'
import { buttonVariants } from '@/components/ui/button'

import { useSession } from '../api/use-session'
import { AuthCard } from '../components/AuthCard'
import { ResetPasswordForm } from '../components/ResetPasswordForm'
import { AUTH_ROUTES } from '../lib/auth-redirects'

/**
 * Reached from `/auth/callback` after a recovery link was exchanged, so the
 * user already has a session. Without one the link was invalid or expired.
 */
export function ResetPasswordPage() {
  const { isLoading, isAuthenticated } = useSession()
  const navigate = useNavigate()

  if (isLoading) {
    return <FullPageSpinner label="Checking your reset link" />
  }

  if (!isAuthenticated) {
    return (
      <AuthCard
        title="Reset link invalid or expired"
        description="Password reset links can only be used once and expire after a short time. Request a new one to continue."
        footer={
          <Link to={AUTH_ROUTES.signIn} className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <Link to={AUTH_ROUTES.forgotPassword} className={buttonVariants({ className: 'w-full' })}>
          Request a new link
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password" description="Pick something you do not use elsewhere.">
      <ResetPasswordForm
        onSuccess={() => {
          toast.success('Password updated')
          navigate('/', { replace: true })
        }}
      />
    </AuthCard>
  )
}
