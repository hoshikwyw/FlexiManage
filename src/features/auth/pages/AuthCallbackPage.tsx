import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { FullPageSpinner } from '@/components/shared/full-page-spinner'
import { buttonVariants } from '@/components/ui/button'

import { useExchangeAuthCode } from '../api/use-exchange-auth-code'
import { AuthCard } from '../components/AuthCard'
import { authErrorFromRedirectParams, getAuthErrorMessage } from '../lib/auth-errors'
import { AUTH_ROUTES, REDIRECT_PARAM, getSafeRedirect } from '../lib/auth-redirects'

/**
 * Target of every Supabase email link (confirmation, recovery, email change).
 * GoTrue redirects here with `?code=<pkce code>` or, on failure, with
 * `error`, `error_code` and `error_description` (query or hash).
 *
 * The code is exchanged once; a recovery link routes to the reset-password
 * form, everything else to the dashboard (or a validated `redirectTo`).
 */
export function AuthCallbackPage() {
  const location = useLocation()
  const navigate = useNavigate()

  const { code, redirectTo, urlError } = useMemo(() => {
    const query = new URLSearchParams(location.search)
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
    return {
      code: query.get('code'),
      redirectTo: getSafeRedirect(query.get(REDIRECT_PARAM)),
      urlError: authErrorFromRedirectParams(query) ?? authErrorFromRedirectParams(hash),
    }
  }, [location.hash, location.search])

  const exchange = useExchangeAuthCode(urlError ? null : code)

  useEffect(() => {
    if (!exchange.data) return
    if (exchange.data.redirectType === 'recovery') {
      navigate(AUTH_ROUTES.resetPassword, { replace: true })
    } else {
      navigate(redirectTo, { replace: true })
    }
  }, [exchange.data, navigate, redirectTo])

  const error = urlError ?? exchange.error ?? (code === null ? new Error('missing code') : null)

  if (error) {
    const isMissingCode = !urlError && !exchange.error
    return (
      <AuthCard
        title="This link cannot be used"
        description={
          isMissingCode
            ? 'The link is incomplete. Open it again from your email, or request a new one.'
            : getAuthErrorMessage(error)
        }
        footer={
          <Link to={AUTH_ROUTES.signIn} className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col gap-2">
          <Link to={AUTH_ROUTES.forgotPassword} className={buttonVariants()}>
            Request a new reset link
          </Link>
          <Link to={AUTH_ROUTES.signUp} className={buttonVariants({ variant: 'outline' })}>
            Sign up again
          </Link>
        </div>
      </AuthCard>
    )
  }

  return <FullPageSpinner label="Completing sign in" />
}
