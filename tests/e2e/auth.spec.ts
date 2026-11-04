import { expect, test } from '@playwright/test'

import { latestMailLink, passwordGrantStatus, signUpViaApi } from './support/api'
import { specData } from './support/data'
import { lit, sql } from './support/db'
import { SKIP_WITHOUT_BACKEND, hasLocalBackend } from './support/env'
import { fillSignIn, signIn, signOut, toast } from './support/pages'

/**
 * Sign-in, redirects, sign-out and password reset (Epic A1). Each worker signs up its own user
 * through the API; the reset test sets a new password through the emailed link and restores the
 * original one afterwards.
 */
test.skip(!hasLocalBackend, SKIP_WITHOUT_BACKEND)

const data = specData('auth')
const user = data.user('user', `Avery Auth ${data.tag}`)
const NEW_PASSWORD = 'e2e-password-2'

test.beforeAll(async () => {
  await signUpViaApi(user)
})

test.afterAll(async () => {
  await data.cleanup()
})

test('sign-in shows required errors without sending a request', async ({ page }) => {
  let tokenRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/token')) tokenRequests += 1
  })
  await page.goto('/auth/sign-in')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Email is required')).toBeVisible()
  await expect(page.getByText('Password is required')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
  expect(tokenRequests).toBe(0)
})

test('sign-in with a wrong password shows a friendly error', async ({ page }) => {
  await page.goto('/auth/sign-in')
  await fillSignIn(page, user.email, 'not-the-password')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/auth\/sign-in/)
})

test('a protected page redirects to sign-in and back after signing in', async ({ page }) => {
  await page.goto('/settings/profile')
  await expect(page).toHaveURL('/auth/sign-in?redirectTo=%2Fsettings%2Fprofile')
  await fillSignIn(page, user.email, user.password)
  await expect(page).toHaveURL('/settings/profile')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await expect(page.getByLabel('Full name')).toHaveValue(user.fullName)
})

test('signing out returns to sign-in and protects routes again', async ({ page }) => {
  await signIn(page, user.email, user.password)
  await signOut(page)
  await expect(toast(page, 'Signed out')).toBeVisible()
  await page.goto('/settings/profile')
  await expect(page).toHaveURL('/auth/sign-in?redirectTo=%2Fsettings%2Fprofile')
})

test('a password reset through the emailed link sets a new password', async ({ page }) => {
  const requestedAt = new Date()
  await page.goto('/auth/forgot-password')
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()

  // The PKCE verifier lives in this browser context, so the link is opened here.
  const link = await latestMailLink(user.email, 'Reset', requestedAt)
  await page.goto(link)
  await expect(page).toHaveURL(/\/auth\/reset-password$/)
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(toast(page, 'Password updated')).toBeVisible()
  await expect(page).not.toHaveURL(/\/auth\//)

  await signOut(page)
  await fillSignIn(page, user.email, NEW_PASSWORD)
  await expect(page).not.toHaveURL(/\/auth\//)
  expect(await passwordGrantStatus(user.email, user.password)).toBe(400)

  // Restore the original password as postgres (bcrypt, as GoTrue stores it) and prove it works.
  await sql(
    `update auth.users set encrypted_password = extensions.crypt(${lit(user.password)}, extensions.gen_salt('bf')) ` +
      `where email = ${lit(user.email)}`,
  )
  expect(await passwordGrantStatus(user.email, user.password)).toBe(200)
  expect(await passwordGrantStatus(user.email, NEW_PASSWORD)).toBe(400)
})
