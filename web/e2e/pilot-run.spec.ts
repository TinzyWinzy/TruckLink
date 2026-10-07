import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'

/**
 * Pilot run — one shift worked end-to-end in practice mode, each leg by the
 * role that owns it on the yard:
 *   DISPATCH  register arrival + run checks (PASS and FAIL)
 *   OPS       assign dock + acknowledge alert + override path
 *   EXECUTIVE export the SLA week
 */

test('DISPATCH registers an arrival — row lands QUEUED', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.getByLabel('License plate').fill('AEZ 1234')
  await page.getByLabel('Driver name').fill('T. Pilot')
  await page.getByRole('button', { name: '+ Register' }).click()
  const row = page.locator('li', { hasText: 'AEZ 1234' })
  await expect(row).toBeVisible()
  await expect(row.getByText('QUEUED')).toBeVisible()
})

test('DISPATCH validates a load — PASS then deliberate FAIL', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/compliance')
  await expect(page.getByRole('heading', { name: 'Pre-departure check' })).toBeVisible()
  for (const item of [
    /Driver license verified/,
    /Vehicle registration verified/,
    /Cargo manifest attached/,
    /Weight certificate recorded/,
    /Axle load calculation within limits/,
  ]) {
    await page.getByRole('checkbox', { name: item }).check()
  }
  await page.getByRole('button', { name: /Validate load/ }).click()
  await expect(page.getByText(/practice check/i)).toBeVisible()

  await page.getByLabel(/Axle 2/).fill('12000')
  await page.getByRole('button', { name: /Validate load/ }).click()
  await expect(page.getByRole('status').filter({ hasText: /FAIL.*quarantine/i })).toBeVisible()
})

test('OPS assigns a dock and acknowledges a critical alert', async ({ page }) => {
  await page.goto('/?demo=1&role=operations')
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/docks')
  await expect(page.getByRole('heading', { name: 'Dock board' })).toBeVisible()
  await page.getByRole('button', { name: /Dock 3/ }).click()
  await expect(page.getByRole('status').filter({ hasText: /Practice.*Dock 3/ })).toBeVisible()

  await page.goto('/alerts')
  const critical = page.locator('li', { hasText: 'AFM 1187 quarantined' })
  await critical.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(critical.getByText('ACKNOWLEDGED')).toBeVisible()
})

test('OPS override path needs a yard entry in practice mode', async ({ page }) => {
  await page.goto('/?demo=1&role=operations')
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/compliance')
  await expect(page.getByRole('heading', { name: 'Pre-departure check' })).toBeVisible()
  await page.getByRole('button', { name: 'Request override' }).click()
  await expect(page.getByText(/need a yard entry/)).toBeVisible()
})

test('DISPATCH cannot acknowledge — read-only by design', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/alerts')
  await expect(page.getByRole('heading', { name: /Alerts/ })).toBeVisible()
  await expect(page.getByText('Read-only. Yard supervisors acknowledge.').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
})

test('entry ID flows board → check without typing', async ({ page }) => {
  await page.goto('/?demo=1&role=dispatch')
  await expect(page).toHaveURL(/\/queue$/)
  const row = page.locator('li', { hasText: 'AEH 4521' })
  await row.getByRole('button', { name: /Copy entry ID/ }).click()
  await expect(page.getByText(/copied/)).toBeVisible()
  await row.getByRole('link', { name: /Open inspection AEH 4521/ }).click()
  await expect(page).toHaveURL(/\/compliance\?entry=/)
  await expect(page.getByLabel('Queue entry ID')).toHaveValue('q1')
})

test('EXECUTIVE exports the SLA week as CSV', async ({ page }) => {
  await page.goto('/?demo=1&role=executive')
  await expect(page).toHaveURL(/\/reports$/)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export CSV/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  const csv = fs.readFileSync(path!, 'utf-8')
  expect(csv.split('\n')[0]).toContain('licensePlate')
  expect(csv).toContain('AEH 4521')
})
