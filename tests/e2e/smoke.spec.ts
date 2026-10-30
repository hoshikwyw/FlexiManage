import { expect, test } from '@playwright/test'

test('unauthenticated visit to / redirects to sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  await expect(page.getByRole('heading', { name: 'FlexiManage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
