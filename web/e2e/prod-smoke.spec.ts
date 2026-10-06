import { expect, test } from '@playwright/test'

/**
 * Production smoke — https://trucki-two.vercel.app/ asserts the deployed gate,
 * the explicit practice validation path (?demo=1), and navigation.
 * Shows ● LIVE only once VITE_API_URL points at the deployed Django API.
 * Yard writes are NOT touched.
 * Run: PW_PROD=1 npx playwright test --project=production
 */

test.beforeEach(async ({ page }) => {
  // Fail before sending any mutation to a real API during smoke testing.
  await page.route('**/api/**', async route => {
    const method = route.request().method()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await route.abort()
      throw new Error(`Production smoke attempted an API mutation: ${method}`)
    }
    await route.continue()
  })
})

test('versioned API is deployed and protects its registry', async ({ request }) => {
  test.skip(!process.env.PW_PROD_API_URL, 'Provide PW_PROD_API_URL to verify the Django release')
  const api = process.env.PW_PROD_API_URL!.replace(/\/$/, '')
  const health = await request.get(`${api}/api/health/`)
  expect(health.ok()).toBe(true)
  expect(await health.json()).toMatchObject({ ok: true })
  for (const resource of ['sources', 'rulesets', 'vehicle-configurations']) {
    const response = await request.get(`${api}/api/regulatory/${resource}/`)
    expect([401, 403]).toContain(response.status())
  }
})

test('gate loads in live mode', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Gate sign-in' })).toBeVisible()
  await expect(page.getByText('● LIVE')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Sign-in method' })).toBeVisible()
})

test('explicit practice entry exposes training roles', async ({ page }) => {
  await page.goto('/?demo=1')
  await expect(page.getByText('Practice sign-in · training only')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Shift role' })).toBeVisible()
})

test('mobile gate fits the viewport and switches sign-in method', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Gate sign-in' })).toBeVisible()
  await page.getByRole('button', { name: /email/i }).click()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('deep link signs Tafadzwa straight into dispatch', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
})

test('View-as switches to executive reports', async ({ page }) => {
  await page.goto('/?demo=1&role=admin')
  await expect(page).toHaveURL(/\/reports$/)
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
