import { expect, test } from '@playwright/test'

const ROLES = [
  'DISPATCH SUPERVISOR',
  'OPERATIONS SUPERVISOR',
  'FACILITY MANAGER',
  'EXECUTIVE',
  'COMPLIANCE OFFICER',
  'ADMIN',
] as const

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Practice harness: no live backend → PRACTICE pill + role radiogroup.
  await expect(page.getByText('■ PRACTICE')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Shift role' })).toBeVisible()
})

test('gate shows all six role tabs, dispatch selected by default', async ({ page }) => {
  for (const r of ROLES) {
    await expect(page.getByRole('radio', { name: new RegExp(r) })).toBeVisible()
  }
  await expect(page.getByRole('radio', { name: /DISPATCH SUPERVISOR/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: /Start shift as DISPATCH SUPERVISOR/ })).toBeVisible()
})

test('selecting a tab updates the CTA and lands on the role home', async ({ page }) => {
  await page.getByRole('radio', { name: /EXECUTIVE/ }).click()
  await expect(page.getByRole('radio', { name: /EXECUTIVE/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: /DISPATCH SUPERVISOR/ })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: /Start shift as EXECUTIVE/ }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByText('Shift performance')).toBeVisible()
})

test('dispatch lands on queue', async ({ page }) => {
  await page.getByRole('button', { name: /Start shift as DISPATCH SUPERVISOR/ }).click()
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByText('Shift queue')).toBeVisible()
})

test('compliance officer lands on pending approvals', async ({ page }) => {
  await page.getByRole('radio', { name: /COMPLIANCE OFFICER/ }).click()
  await page.getByRole('button', { name: /Start shift as COMPLIANCE OFFICER/ }).click()
  await expect(page).toHaveURL(/\/approvals$/)
  await expect(page.getByRole('heading',{name:'Pending approvals'})).toBeVisible()
})

test('deep link ?role=dispatch signs straight into the shift', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByText('Shift queue')).toBeVisible()
})

test('header View-as switcher changes role without sign-out', async ({ page }) => {
  await page.goto('/?demo=1&role=admin')
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByLabel('Switch practice role').selectOption('EXECUTIVE')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByText('Shift performance')).toBeVisible()
})

test('practice session survives refresh (tab close signs out by design)', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.reload()
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByText('Shift queue')).toBeVisible()
})

test('dispatch is gated out of docks (dead-end, no redirect loop)', async ({ page }) => {
  await page.getByRole('button', { name: /Start shift as DISPATCH SUPERVISOR/ }).click()
  await expect(page).toHaveURL(/\/queue$/)
  // Client-side navigation (no full reload, so the practice session holds).
  await page.evaluate(() => {
    window.history.pushState({}, '', '/docks')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByText('Not permitted')).toBeVisible()
  await expect(page).toHaveURL(/\/docks$/)
})


test('only an admin account sees role switching, including after refresh', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
  await expect(page.getByLabel('Switch practice role')).toHaveCount(0)
  await page.getByText('Account',{exact:true}).click();await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto('/?demo=1&role=admin')
  await page.getByLabel('Switch practice role').selectOption('DISPATCH_SUPERVISOR')
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Switch practice role')).toBeVisible()
  await page.getByLabel('Switch practice role').selectOption('ADMIN')
  await expect(page).toHaveURL(/\/reports$/)
})
