import { expect, test } from '@playwright/test'

// Boots against the CI-bootstrap Django tenant (see .github/workflows/ci.yml):
// org "CI Fleet", facility slug ci-yard, staff TRK-CI-1 / PIN 1234, seed = 7
// queue rows + 4 docks + 2 alerts. Signup does not approve operational activation.
test('seeded unreleased yard: PIN sign-in lands dispatch on its scoped workspace', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Online',{exact:true})).toBeVisible()
  await expect(page.getByText('■ PRACTICE')).toHaveCount(0)

  await page.fill('#staffId', 'TRK-CI-1')
  await page.fill('#pin', '1234')
  await page.getByRole('button', { name: 'Sign in to shift' }).click()

  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('heading', { name: 'Your workspace', exact: true })).toBeVisible()
  await expect(page.getByText('Operational activation is pending discovery and review.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Queue', exact: true })).toHaveCount(0)
  // Seeding demo records must not expose an unapproved operational workspace.
  await expect(page.getByText('AEH 4521')).toHaveCount(0)
})

test('wrong PIN fails with a yard-language error and stays on the gate', async ({ page }) => {
  await page.goto('/')
  await page.fill('#staffId', 'TRK-CI-1')
  await page.fill('#pin', '9999')
  await page.getByRole('button', { name: 'Sign in to shift' }).click()
  await expect(page.getByRole('alert')).toContainText(/Staff ID or PIN did not match/)
  await expect(page).toHaveURL(/\/?$/)
})
