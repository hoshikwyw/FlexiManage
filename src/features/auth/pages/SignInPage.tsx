import { Link } from 'react-router-dom'

import { AuthCard } from '../components/AuthCard'
import { SignInForm } from '../components/SignInForm'
import { AUTH_ROUTES } from '../lib/auth-redirects'

export function SignInPage() {
  // On success the session lands in the cache and `PublicOnlyRoute` redirects
  // to `redirectTo` (validated) or the dashboard.
  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Enter your details to continue."
      footer={
        <span>
          No account yet?{' '}
          <Link to={AUTH_ROUTES.signUp} className="text-foreground underline underline-offset-4">
            Create one
          </Link>
        </span>
      }
    >
      <SignInForm />
    </AuthCard>
  )
}
