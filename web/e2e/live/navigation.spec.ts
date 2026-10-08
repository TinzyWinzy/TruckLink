import { test, expect } from '@playwright/test'

test('tenant navigation stays usable on desktop, tablet and phone', async ({ page }, testInfo) => {
  const errors: string[] = []
  const writes: string[] = []
  const roles = Object.fromEntries(['ADMIN', 'DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'COMPLIANCE_OFFICER'].map(role => [role, { enabled: true, label: role.replace(/_/g, ' ') }]))
  const configuration = { version: 2, digest: 'synthetic-navigation', content: {
    schema_version: 1,
    branding: { display_name: 'Northstar Transport and Distribution Services', accent: '#2563eb', navy: '#101c30', paper: '#f4f6fa' },
    roles, permissions: {}, workflow: { mandatory_checks: ['driver-license'], inspection_max_age_seconds: 3600, escalation_minutes: { FM: 10, EXEC: 30 } }, integrations: {},
  } }
  const user = { id: 42, username: 'synthetic-navigation-admin', role: 'ADMIN', base_role: 'ADMIN', organisation: { id: 42, name: configuration.content.branding.display_name, slug: 'northstar' }, facilities: [{ id: 84, name: 'Northstar Distribution Centre and Main Yard', slug: 'northstar-yard' }], tenant_configuration: configuration }
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/auth/me/' && !request.headers().authorization) {
      await route.fulfill({ status: 401, json: {} })
      return
    }
    if (!path.startsWith('/api/auth/') && request.method() !== 'GET') writes.push(path)
    let response: unknown = { alerts: [], records: [] }
    if (path.startsWith('/api/auth/')) response = { token: 'synthetic-only', user }
    if (path === '/api/docks/') response = { docks: [] }
    if (path === '/api/tenant/configuration/') response = { configuration }
    if (path === '/api/tenant/registry/') response = { modules: { yard: [], inspection: ['yard'], release: ['inspection'], routing: [], audit: [] }, release: null, activation_version: 0 }
    if (path === '/api/tenant/revisions/') response = { revisions: [] }
    if (path === '/api/tenant/releases/') response = { releases: [] }
    await route.fulfill({ json: response })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByLabel('Staff ID', { exact: true }).fill('SYNTHETIC-NAVIGATION')
  await page.getByLabel('PIN', { exact: true }).fill('112233')
  await page.getByRole('button', { name: 'Sign in to shift', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await navigation.getByRole('link', { name: 'Admin', exact: true }).click()
  await expect(page.getByLabel('Tenant display name')).toHaveValue(configuration.content.branding.display_name)
  await expect(navigation.getByRole('link', { name: 'Admin', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden()
  await expect(page.getByLabel('Selected yard')).toBeVisible()
  await expect(page.getByLabel('Switch working role')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('navigation-desktop.png') })

  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByLabel('Selected yard')).toBeVisible()
    await expect(page.getByLabel('Switch working role')).toBeVisible()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(navigation).toBeHidden()
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  await menu.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('navigation-mobile-open.png') })
  await navigation.getByRole('link', { name: 'Audit', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  await expect(navigation).toBeHidden()
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByText('Account', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('navigation-mobile-account.png') })
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})
