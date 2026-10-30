import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { AuthCard } from '../components/AuthCard'
import { ForgotPasswordForm } from '../components/ForgotPasswordForm'
import { LocalInboxHint } from '../components/LocalInboxHint'
import { AUTH_ROUTES } from '../lib/auth-redirects'

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (sentTo) {
    return (
      <AuthCard
        title="Check your inbox"
        description={`If an account exists for ${sentTo}, we sent a link to reset your password. The link expires after a short time.`}
        footer={
          <Link to={AUTH_ROUTES.signIn} className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col gap-4">
          <LocalInboxHint />
          <Button type="button" variant="outline" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send you a link to choose a new password."
      footer={
        <Link to={AUTH_ROUTES.signIn} className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm
        onSuccess={({ email }) => {
          setSentTo(email)
          toast.success('Reset link sent')
        }}
      />
    </AuthCard>
  )
}
