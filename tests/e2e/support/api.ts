import { expect } from '@playwright/test'

import type { E2eUser } from './data'
import { MAILPIT_URL, supabaseAnonKey, supabaseUrl } from './env'

/**
 * Direct HTTP helpers for setup that does not need to go through the UI. Only the public anon
 * key is used; no service-role key is ever read by a spec.
 */

/** Sign up through GoTrue (local email confirmation is off, so the user can sign in at once). */
export async function signUpViaApi(user: E2eUser): Promise<string> {
  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      data: { full_name: user.fullName },
    }),
  })
  const body = (await response.json()) as { user?: { id?: string }; id?: string; msg?: string }
  const id = body.user?.id ?? body.id
  if (!response.ok || !id) throw new Error(`sign-up of ${user.email} failed: ${response.status}`)
  return id
}

/** HTTP status of a password-grant sign-in (200 or 400). */
export async function passwordGrantStatus(email: string, password: string): Promise<number> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  await response.body?.cancel()
  return response.status
}

interface MailpitAddress {
  Address: string
}
interface MailpitSummary {
  ID: string
  To: MailpitAddress[]
  Subject: string
  Created: string
}

/**
 * The newest link to GoTrue's `/auth/v1/verify` in a mail to `to` whose subject contains
 * `subject`, sent after `since`. Polls Mailpit (no fixed sleeps).
 */
export async function latestMailLink(to: string, subject: string, since: Date): Promise<string> {
  let link = ''
  await expect
    .poll(
      async () => {
        const list = (await (
          await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
        ).json()) as { messages: MailpitSummary[] }
        const message = list.messages.find(
          (m) =>
            m.Subject.includes(subject) &&
            new Date(m.Created).getTime() >= since.getTime() - 1000 &&
            m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()),
        )
        if (!message) return ''
        const full = (await (
          await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
        ).json()) as {
          Text: string
        }
        link = /https?:\/\/\S+\/auth\/v1\/verify\S+/.exec(full.Text)?.[0] ?? ''
        return link
      },
      { message: `mail "${subject}" to ${to} in Mailpit`, timeout: 20_000 },
    )
    .not.toBe('')
  return link
}
