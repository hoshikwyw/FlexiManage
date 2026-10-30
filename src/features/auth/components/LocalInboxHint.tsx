import { getLocalMailInboxUrl } from '../lib/auth-redirects'

/** Dev-only pointer to the local Supabase mail inbox (Mailpit / Inbucket). */
export function LocalInboxHint() {
  const inboxUrl = getLocalMailInboxUrl()
  if (!import.meta.env.DEV || !inboxUrl) return null

  return (
    <p className="text-muted-foreground bg-muted rounded-lg px-3 py-2 text-xs">
      Local development: emails are not delivered. Open the local inbox at{' '}
      <a href={inboxUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
        {inboxUrl}
      </a>
      .
    </p>
  )
}
