import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'

test('BAK workbench stays usable on desktop and mobile', async ({ page }) => {
  mkdirSync('../docs/design', { recursive: true })
  await page.goto('/?demo=1&role=dispatch')
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `../docs/design/bak-${name}.png`, fullPage: true })
  }
  await page.getByRole('link', { name: 'Compliance', exact: true }).click()
  await expect(page).toHaveURL(/\/compliance/)
})

test('Reports connects status evidence to review actions on desktop and mobile', async ({ page }) => {
  await page.goto('/?demo=1&role=executive')
  await expect(page.getByRole('heading', { name: 'Shift performance' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Queue distribution' })).toContainText('8 loaded')
  await expect(page.getByRole('region', { name: 'Review priority' })).toContainText('2 movements need controlled review')
  await expect(page.getByRole('link', { name: 'Explore synthetic modelling' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Data availability' })).toContainText('Practice dataset')
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `../docs/design/trucki-reports-${name}.png`, fullPage: true })
  }
  await page.getByRole('link', { name: 'Explore synthetic modelling' }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic modelling' })).toBeVisible()
})



