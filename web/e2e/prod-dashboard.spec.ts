import { test, expect } from '@playwright/test'

test.use({ trace: 'off' })

test('production dashboard and consignment APIs require authentication', async ({ request }) => {
  test.skip(!process.env.PW_PROD_API_URL, 'Production API URL required')
  for (const path of ['/reports/dashboard/?facility=1', '/consignments/?facility=1']) {
    const response = await request.get(`${process.env.PW_PROD_API_URL}/api${path}`)
    expect([401, 403]).toContain(response.status())
  }
})

test('production practice dashboard exposes labelled graphs on desktop and mobile', async ({ page }) => {
  await page.route('**/api/**', async route => {
    expect(['GET', 'HEAD', 'OPTIONS']).toContain(route.request().method())
    await route.continue()
  })
  await page.goto('/?demo=1&role=admin')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByText('Synthetic practice data', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Yard activity chart' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Time in yard', exact: true })).toBeVisible()
  await page.getByLabel('Chart window').selectOption('7d')
  await expect(page.getByRole('region', { name: 'Yard activity chart' })).toContainText('Daily counts')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('production live dashboard polls and consignment register reads without operational writes', async ({ page, request }, testInfo) => {
  test.skip(!process.env.BAK_ADMIN_PIN, 'Current administrator PIN required')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request()
    if (!new URL(req.url()).pathname.startsWith('/api/auth/')) expect(['GET', 'HEAD', 'OPTIONS']).toContain(req.method())
    await route.continue()
  })
  await page.goto('/')
  await page.getByLabel('Staff ID', { exact: true }).fill(process.env.BAK_ADMIN_STAFF_ID || 'TRK-BAK-ADMIN')
  await page.getByLabel('PIN', { exact: true }).fill(process.env.BAK_ADMIN_PIN!)
  await page.getByRole('button', { name: 'Sign in to shift', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('region', { name: 'Yard activity chart' })).toBeVisible()
  await expect(page.getByText(/polls every 5 seconds/)).toBeVisible()
  const headers = { Authorization: `Token ${await page.evaluate(() => localStorage.getItem('trucki-auth-token'))}` }
  const api = process.env.PW_PROD_API_URL!
  const me = await (await request.get(`${api}/api/auth/me/`, { headers })).json()
  const facility = me.user.facilities[0].id
  for (const window of ['24h', '7d', '30d']) {
    const response = await request.get(`${api}/api/reports/dashboard/?facility=${facility}&window=${window}`, { headers })
    expect(response.ok()).toBe(true)
    expect(response.headers()['cache-control']).toContain('no-store')
    const data = await response.json()
    expect(data.metric_version).toBe('yard-dashboard-1')
    expect(data.facility.id).toBe(facility)
    expect(data.window.key).toBe(window)
    expect(data.summary.arrivals).toBe(data.series.reduce((sum: number, bucket: { arrivals: number }) => sum + bucket.arrivals, 0))
    expect(data.summary.physical_exits).toBe(data.series.reduce((sum: number, bucket: { exits: number }) => sum + bucket.exits, 0))
    expect(data.coverage.erp).toBe('NOT_CONFIGURED')
    expect(data.coverage.tracker).toBe('NOT_CONFIGURED')
  }
  const poll = await page.waitForResponse(response => response.url().includes('/reports/dashboard/') && response.ok(), { timeout: 12000 })
  expect((await poll.json()).window.key).toBe('24h')
  await page.getByLabel('Chart window').selectOption('7d')
  await expect(page.getByRole('region', { name: 'Yard activity chart' })).toContainText('Daily counts')
  await page.screenshot({ path: testInfo.outputPath('live-dashboard-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('live-dashboard-mobile.png'), fullPage: true })
  const consignmentResponse = await request.get(`${api}/api/consignments/?facility=${facility}`, { headers })
  expect(consignmentResponse.ok()).toBe(true)
  const register = await consignmentResponse.json()
  expect(register.facility.id).toBe(facility)
  expect(register.organisation.id).toBe(me.user.organisation.id)
  expect(Array.isArray(register.records)).toBe(true)
  await page.goto('/consignments')
  await expect(page.getByLabel('Search customer, consignment or order reference')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh consignments' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New consignment' })).toBeVisible()
  await expect(page.getByText('Loading consignments…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  await page.getByText('Account', { exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
})
