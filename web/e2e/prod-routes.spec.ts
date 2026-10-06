import { test, expect } from '@playwright/test'

test.use({ trace: 'off' })
test('production yard routes, real provider preview and synthetic map stay separate', async ({ page }) => {
  test.skip(!process.env.BAK_ADMIN_PIN, 'Explicit admin credentials required')
  test.setTimeout(150000)
  const errors: string[] = []
  const tileStatuses: number[] = []
  const draftWrites: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Request interception disables browser caching, which is prohibited by OSM's tile policy.
  page.on('response', response => { if (response.url().startsWith('https://tile.openstreetmap.org/')) tileStatuses.push(response.status()) })
  page.on('request', request => { if (request.url().endsWith('/api/routes/drafts/')) draftWrites.push(request.method()) })
  await page.goto('/')
  await page.getByLabel('Staff ID', { exact: true }).fill(process.env.BAK_ADMIN_STAFF_ID || 'TRK-BAK-ADMIN')
  await page.getByLabel('PIN', { exact: true }).fill(process.env.BAK_ADMIN_PIN!)
  await page.getByRole('button', { name: 'Sign in to shift', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  const workspace = page.waitForResponse(r => r.url().includes('/api/routes/workspace/?facility=') && r.status() === 200)
  await page.getByRole('link', { name: 'Routes & map', exact: true }).click()
  const body = await (await workspace).json()
  expect(body.facility.id).toBeTruthy()
  expect(body.can_save).toBe(true)
  await expect(page.getByRole('button', { name: 'Operational trips', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Save draft trip' })).toBeDisabled()
  if (process.env.PW_ROUTE_PREVIEW === '1') {
    const preview = page.waitForResponse(r => r.url().endsWith('/api/routes/preview/'), { timeout: 110000 })
    await page.getByRole('button', { name: 'Preview road route' }).click()
    const result = await preview
    expect(result.status(), await result.text()).toBe(200)
    const routing = (await result.json()).routing
    expect(routing.stops).toHaveLength(2)
    expect(routing.distance_km).toBeGreaterThan(0)
    expect(routing.regulatory_clearance).toBe('NOT_EVALUATED')
    expect(routing.heavy_vehicle_suitability).toBe('UNVERIFIED')
    await expect(page.getByRole('button', { name: 'Save draft trip' })).toBeEnabled()
    await expect(page.getByText('OSRM public demo', { exact: true })).toBeVisible()
    await page.getByLabel('Origin', { exact: true }).fill('Mutare, Zimbabwe')
    await expect(page.getByRole('button', { name: 'Save draft trip' })).toBeDisabled()
  }
  await page.getByRole('button', { name: 'Synthetic journeys', exact: true }).click()
  await page.getByRole('button', { name: /SYN-9001/ }).click()
  await expect(page.getByText(/Stale position; current location is unknown/)).toBeVisible()
  await expect(page.locator('.route-stop-icon')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Save draft trip' })).toHaveCount(0)
  await expect.poll(() => page.locator('.leaflet-tile').evaluateAll(images => images.some(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)), { timeout: 30000 }).toBe(true)
  expect(tileStatuses).toContain(200)
  expect(tileStatuses.filter(status => status >= 400)).toEqual([])
  expect(draftWrites).toEqual([])
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `../docs/design/trucki-routes-production-${name}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
})
