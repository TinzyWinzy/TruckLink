import { test, expect } from '@playwright/test'

test('synthetic routes show ordered stops and stale position evidence on desktop and mobile', async ({ page }) => {
  await page.goto('/?demo=1&role=admin')
  await page.getByRole('link', { name: 'Routes & map', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Routes & map', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Synthetic journeys', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /SYN-9001/ }).click()
  await expect(page.getByText('Stale position; current location is unknown.', { exact: false })).toBeVisible()
  await expect(page.getByText(/Declared jurisdictions: ZW, ZA/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save draft trip' })).toHaveCount(0)
  await expect(page.locator('.route-stop-icon')).toHaveCount(3)
  await expect(page.getByText('Road distance unavailable', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Expand map' }).click()
  await expect(page.getByRole('button', { name: 'Reduce map' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Expand map' })).toBeVisible()
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `../docs/design/trucki-routes-${name}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: /SYN-9002/ }).click()
  await expect(page.getByText('Current vehicle location is unknown.', { exact: true })).toBeVisible()
})

test('unavailable imagery keeps itinerary evidence usable', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/?demo=1&role=executive')
  await page.getByRole('link', { name: 'Routes & map', exact: true }).click()
  await expect(page.getByText(/Map imagery is unavailable/)).toBeVisible()
  await page.getByRole('button', { name: /SYN-9001/ }).click()
  await expect(page.getByRole('heading', { name: 'Ordered itinerary' })).toBeVisible()
  await expect(page.locator('.route-stop-icon')).toHaveCount(3)
})
