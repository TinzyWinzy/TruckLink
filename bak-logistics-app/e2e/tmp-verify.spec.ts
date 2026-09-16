import { expect, test } from '@playwright/test'

/**
 * THROWAWAY migration verify — deleted after the run. Secrets come from
 * process env (BAK_PIN, BAK_TEST_PASSWORD), never committed.
 */
const PLATE = `ATZ ${String(Date.now() % 100000).padStart(5, '0').slice(0, 4)}`

test('Tafadzwa PIN sign-in + register on the new backend', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Gate sign-in' })).toBeVisible()
  await page.getByLabel('Staff ID').fill('BAK-07-TAFADZWA')
  await page.getByLabel('PIN', { exact: true }).fill(process.env.BAK_PIN!)
  await page.getByRole('button', { name: 'Sign in to shift' }).click()
  await expect(page).toHaveURL(/\/queue$/, { timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
  await page.getByLabel('License plate').fill(PLATE)
  await page.getByLabel('Driver name').fill('Verify Run')
  await page.getByRole('button', { name: '+ Register' }).click()
  await expect(page.locator('li', { hasText: PLATE })).toBeVisible({ timeout: 20000 })
})

test('admin email sign-in reads the audit trail', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Email', exact: true }).click()
  await page.getByLabel('Email').fill('bak.test.admin@radbit.studio')
  await page.getByLabel('Password').fill(process.env.BAK_TEST_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in to shift' }).click()
  await expect(page).toHaveURL(/\/reports$/, { timeout: 20000 })
  // Refresh round-trip: real sessions must restore without re-sign-in.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Shift performance' })).toBeVisible({ timeout: 20000 })
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible()
})
