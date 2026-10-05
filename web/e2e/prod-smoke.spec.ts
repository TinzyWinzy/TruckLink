import { expect, test } from '@playwright/test'

/**
 * Production smoke — https://trucki-two.vercel.app/ asserts the deployed gate,
 * the practice validation path (VITE_ALLOW_DEMO=true), and navigation.
 * Shows ● LIVE only once VITE_API_URL points at the deployed Django API.
 * Yard writes are NOT touched.
 * Run: PW_PROD=1 npx playwright test --project=production
 */

test('gate loads in live mode with practice tabs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Gate sign-in' })).toBeVisible()
  await expect(page.getByText('● LIVE')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Sign-in method' })).toBeVisible()
  await expect(page.getByText('Practice sign-in · training only')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Shift role' })).toBeVisible()
})

test('deep link signs Tafadzwa straight into dispatch', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
})

test('View-as switches to executive reports', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.getByLabel('Switch practice role').selectOption('EXECUTIVE')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByText('Shift performance')).toBeVisible()
})

test('Hub and Guide load for the walkthrough', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/hub')
  await expect(page.getByRole('heading', { name: 'Information hub' })).toBeVisible()
  await page.goto('/guide')
  await expect(page.getByRole('heading', { name: /walkthrough/ })).toBeVisible()
})

test('practice session survives refresh on prod', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.reload()
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
})
