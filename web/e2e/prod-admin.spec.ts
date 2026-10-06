import { test, expect } from '@playwright/test'

test.use({ trace: 'off' })
test('live ADMIN PIN can switch working roles and return without changing identity', async ({ page, request }) => {
  test.skip(!process.env.BAK_ADMIN_PIN, 'Explicit admin credentials required')
  await page.goto('/')
  await page.getByLabel('Staff ID', { exact: true }).fill(process.env.BAK_ADMIN_STAFF_ID || 'TRK-BAK-ADMIN')
  await page.getByLabel('PIN', { exact: true }).fill(process.env.BAK_ADMIN_PIN!)
  await page.getByRole('button', { name: 'Sign in to shift', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByText(/Last successful read/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Review priority' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Data availability' })).toContainText('movements loaded')
  const api = process.env.PW_PROD_API_URL!
  const token = await page.evaluate(() => localStorage.getItem('trucki-auth-token'))
  const headers = { Authorization: `Token ${token}` }
  const original = (await (await request.get(`${api}/api/auth/me/`, { headers })).json()).user
  expect(original.role).toBe('ADMIN')
  await page.getByLabel('Switch working role').selectOption('DISPATCH_SUPERVISOR')
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const switched = (await (await request.get(`${api}/api/auth/me/`, { headers })).json()).user
  expect(switched.id).toBe(original.id)
  expect(switched.role).toBe('DISPATCH_SUPERVISOR')
  expect(switched.base_role).toBe('ADMIN')
  const queue = await request.get(`${api}/api/queue/?facility=${original.facilities[0].id}`, { headers })
  expect(queue.ok()).toBe(true)
  await page.reload()
  await expect(page.getByLabel('Switch working role')).toHaveValue('DISPATCH_SUPERVISOR')
  await page.getByLabel('Switch working role').selectOption('ADMIN')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByLabel('Switch working role')).toHaveValue('ADMIN')
  await expect(page.getByText(/Last successful read/)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: '../docs/design/bak-live-admin.png', fullPage: true })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Gate sign-in' })).toBeVisible()
})
