import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { AuthCard } from '../components/AuthCard'
import { SignUpForm } from '../components/SignUpForm'
import { AUTH_ROUTES } from '../lib/auth-redirects'

export function SignUpPage() {
  const navigate = useNavigate()
  // Keep `?redirectTo=` on the cross-link so the invite path survives a detour
  // through sign-in.
  const { search } = useLocation()

  return (
    <AuthCard
      title="Create your account"
      description="Start managing your business in minutes."
      footer={
        <span>
          Already have an account?{' '}
          <Link
            to={{ pathname: AUTH_ROUTES.signIn, search }}
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </span>
      }
    >
      <SignUpForm
        onSuccess={(result, values) => {
          if (result.needsEmailConfirmation) {
            const search = new URLSearchParams({ email: values.email })
            navigate(`${AUTH_ROUTES.verifyEmail}?${search.toString()}`, { replace: true })
            return
          }
          // Email confirmation disabled (local stack): the user is signed in and
          // `PublicOnlyRoute` sends them to the dashboard.
          toast.success('Account created. Welcome to FlexiManage!')
        }}
      />
    </AuthCard>
  )
}
