import { test, expect } from '@playwright/test'

test('dock screen shares a compact board poll and switches yard scope without retaining rows', async ({ page }) => {
  const reads: string[] = []
  const user = { id: 42, username: 'synthetic-poll-ops', role: 'OPERATIONS_SUPERVISOR',
    base_role: 'OPERATIONS_SUPERVISOR', organisation: { id: 8, name: 'Synthetic fleet', slug: 'synthetic' },
    facilities: [{ id: 10, name: 'Synthetic yard A', slug: 'a' }, { id: 11, name: 'Synthetic yard B', slug: 'b' }] }
  await page.clock.install()
  await page.addInitScript(() => localStorage.setItem('trucki-auth-token', 'synthetic-poll-only'))
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let response: unknown = {}
    if (url.pathname === '/api/auth/me/') response = { user }
    if (url.pathname === '/api/yard/board/') {
      const site = url.searchParams.get('facility')!
      reads.push(site)
      expect(url.searchParams.get('scope')).toBe('active')
      expect(url.searchParams.get('compact')).toBe('1')
      response = { queue: [{ id: 7, reg_number: `TEST-${site}`, status: 'QUEUED' }],
        docks: [{ id: 9, name: `Dock at yard ${site}`, status: 'AVAILABLE' }],
        alerts: [{ id: 4, severity: 'CRITICAL', acknowledged: false, message: 'Synthetic critical alert' }] }
    }
    await route.fulfill({ json: response })
  })
  await page.goto('/docks')
  await expect(page.getByText('Dock at yard 10', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '1 critical' })).toBeVisible()
  expect(reads).toEqual(['10'])
  await page.clock.runFor(5000)
  await expect.poll(() => reads.length).toBe(2)
  expect(reads).toEqual(['10', '10'])
  await page.getByLabel('Selected yard').selectOption('11')
  await expect(page.getByText('Dock at yard 11', { exact: true })).toBeVisible()
  await expect(page.getByText('Dock at yard 10', { exact: true })).toHaveCount(0)
  expect(reads).toEqual(['10', '10', '11'])
})
