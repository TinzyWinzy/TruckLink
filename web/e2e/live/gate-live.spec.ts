import { expect, test } from '@playwright/test'

// Boots against the CI-bootstrap Django tenant (see .github/workflows/ci.yml):
// org "CI Fleet", facility slug ci-yard, staff TRK-CI-1 / PIN 1234, seed = 7
// queue rows + 4 docks + 3 alerts.
test('seeded yard: PIN sign-in lands dispatch on the live queue', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('● LIVE')).toBeVisible()
  await expect(page.getByText('■ PRACTICE')).toHaveCount(0)

  await page.fill('#staffId', 'TRK-CI-1')
  await page.fill('#pin', '1234')
  await page.getByRole('button', { name: 'Sign in to shift' }).click()

  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByText('Shift queue')).toBeVisible()
  // Seeded row from the board poll (facility ci-yard).
  await expect(page.getByText('AEH 4521')).toBeVisible()
})

test('wrong PIN fails with a yard-language error and stays on the gate', async ({ page }) => {
  await page.goto('/')
  await page.fill('#staffId', 'TRK-CI-1')
  await page.fill('#pin', '9999')
  await page.getByRole('button', { name: 'Sign in to shift' }).click()
  await expect(page.getByRole('alert')).toContainText(/Staff ID or PIN did not match/)
  await expect(page).toHaveURL(/\/?$/)
})
