import { expect, test, type Page } from '@playwright/test'

const entries = JSON.parse(process.env.STORY_ENTRIES!) as Record<string, number>
const actors = JSON.parse(process.env.STORY_ACTORS!) as Record<string, string>
const api = process.env.STORY_API_URL!

async function login(page: Page, actor: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Email', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill(actors[actor])
  await page.getByLabel('Password', { exact: true }).fill('synthetic-flow-only-123')
  await page.getByRole('button', { name: 'Sign in to shift', exact: true }).click()
  await expect(page).toHaveURL(/\/queue$/)
}
async function inspect(page: Page, name: string, overloaded = false) {
  await page.goto(`/compliance?entry=${entries[name]}`)
  await expect(page.getByText('Operational gate inspection')).toBeVisible()
  const values = overloaded ? ['9000', '8000', '8000'] : ['6000', '8000', '8000']
  for (let i = 0; i < values.length; i++) await page.getByLabel(`Axle ${i + 1}`, { exact: true }).fill(values[i])
  await page.getByLabel('Total', { exact: true }).fill(overloaded ? '25000' : '22000')
  for (const box of await page.getByRole('checkbox').all()) await box.check()
  await page.getByRole('button', { name: 'Record versioned inspection' }).click()
}
async function headers(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('trucki-auth-token'))
  return { Authorization: `Token ${token}` }
}
async function release(page: Page, name: string) {
  await page.goto('/queue')
  await page.getByRole('button', { name: 'Release SYNTH 100', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Release SYNTH 100', exact: false })).toHaveCount(0)
  const row = page.getByRole('listitem').filter({ has: page.locator(`a[href="/compliance?entry=${entries[name]}"]`) })
  await expect(row).toContainText('RELEASED')
}

test('BAK-01/06/15/16/21: inspector records PASS, refreshes and releases', async ({ page }) => {
  await login(page, 'inspector')
  await inspect(page, 'clean')
  await expect(page.getByText(/Inspection \d+ · PASS$/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Inspection \d+ · PASS$/)).toBeVisible()
  await release(page, 'clean')
})

test('BAK-16/18/21: quarantine denies bypass; corrected reinspection releases', async ({ page }) => {
  await login(page, 'inspector')
  await inspect(page, 'remediation', true)
  await expect(page.getByText(/Inspection \d+ · QUARANTINE$/)).toBeVisible()
  const auth = await headers(page)
  const blocked = await page.request.post(`${api}/api/queue/${entries.remediation}/release/`, { headers: auth })
  expect(blocked.status()).toBe(409)
  const bypass = await page.request.patch(`${api}/api/queue/${entries.remediation}/`, { headers: auth, data: { status: 'RELEASED' } })
  expect(bypass.ok()).toBe(false)
  await inspect(page, 'remediation')
  await expect(page.getByText(/Inspection \d+ · PASS$/)).toBeVisible()
  await release(page, 'remediation')
})

test('BAK-19/20/21: self-approval denied; separate supervisor approves and releases', async ({ page }) => {
  await login(page, 'inspector')
  await inspect(page, 'exception', true)
  await expect(page.getByText(/Inspection \d+ · QUARANTINE$/)).toBeVisible()
  await page.getByText('Account',{exact:true}).click();await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await login(page, 'requester')
  await page.goto(`/compliance?entry=${entries.exception}`)
  await page.getByLabel('Review reason').fill('Synthetic permitted exception request')
  await page.getByRole('button', { name: 'Request exception', exact: true }).click()
  await expect(page.getByText('Override requested. A separate supervisor must review it.')).toBeVisible()
  const auth = await headers(page)
  const context = await (await page.request.get(`${api}/api/regulatory/queue/${entries.exception}/context/`, { headers: auth })).json()
  const detail = await (await page.request.get(`${api}/api/regulatory/attempts/${context.attempt.id}/`, { headers: auth })).json()
  const selfApproval = await page.request.post(`${api}/api/regulatory/override-requests/${detail.requests.at(-1).id}/approve/`,
    { headers: auth, data: { approved: true, reason: 'Self approval must fail' } })
  expect(selfApproval.ok()).toBe(false)
  await page.getByText('Account',{exact:true}).click();await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await login(page, 'approver')
  await page.goto(`/compliance?entry=${entries.exception}`)
  await page.getByLabel('Review reason').fill('Independent synthetic review')
  await page.getByRole('button', { name: 'Approve independently', exact: true }).click()
  await expect(page.getByText('Independent approval recorded; original inspection remains unchanged.')).toBeVisible()
  await expect(page.getByText(/Inspection \d+ · QUARANTINE$/)).toBeVisible()
  await release(page, 'exception')
})

test('BAK-16/28: absent corridor configuration never passes or permits an exception', async ({ page }) => {
  await login(page, 'inspector')
  await inspect(page, 'missing')
  await expect(page.getByText(/Inspection \d+ · REVIEW_REQUIRED$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request exception', exact: true })).toHaveCount(0)
  const response = await page.request.post(`${api}/api/queue/${entries.missing}/release/`, { headers: await headers(page) })
  expect(response.status()).toBe(409)
})
