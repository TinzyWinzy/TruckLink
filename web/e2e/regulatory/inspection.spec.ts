import { expect, test } from '@playwright/test'

test('operational inspection uses evidenced ratings and shows a held source control', async ({ page }) => {
  const submitted: Record<string, unknown>[] = []
  await page.addInitScript(() => localStorage.setItem('trucki-auth-token', 'synthetic-ui-token'))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { ok: true, alerts: [], queue: [], config: [] }
    if (path === '/api/auth/me/') body = { user: { id: 1, username: 'Synthetic inspector', role: 'DISPATCH_SUPERVISOR' } }
    if (path === '/api/regulatory/queue/10/context/') body = {
      mode: 'VERSIONED', readiness_error: null, attempt: null,
      context: { id: 5, driver: 2, trip: 3, load: 4, jurisdictions: ['TEST'], route_type: 'DOMESTIC', origin: 'A', destination: 'B' },
      configuration: { id: 9, revision: 2, vehicle: 1, vehicle_class: 'SYNTHETIC', rated_axle_kg: ['12000','12000'], rated_gross_kg: '24000', review_status: 'REVIEWED' },
      rulesets: [],
    }
    if (path === '/api/regulatory/evaluate/') {
      submitted.push(route.request().postDataJSON())
      body = { attempt: { id: 7, creator: 1, decision: 'HOLD', result: {
        controls: [{ id: 'document', status: 'HOLD', reason: 'Synthetic document missing',
          provenance: { ruleset_id: 1, digest: 'fixture-only', source: { title: 'Synthetic internal policy', provision: 'TEST ONLY', revision: 2, kind: 'INTERNAL_POLICY' } } }],
        readiness_percent: 50, override_eligible: false, engine_version: 'nrok-1', monetary_penalty: null,
      } }, replayed: false }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/compliance?entry=10')
  await expect(page.getByText('Operational gate inspection')).toBeVisible()
  await page.getByText('Recorded context and rule details', { exact: true }).click()
  await expect(page.getByText(/configuration revision 2/)).toBeVisible()
  await expect(page.getByLabel('GVM')).toHaveCount(0)
  await page.getByLabel('Axle 1', { exact: true }).fill('8000')
  await page.getByLabel('Axle 2', { exact: true }).fill('8000')
  await page.getByLabel('Total', { exact: true }).fill('16000')
  await page.getByRole('button', { name: 'Record versioned inspection' }).click()
  await expect(page.getByText('Inspection 7 · HOLD')).toBeVisible()
  await page.getByText('Evidence details', { exact: true }).click()
  await expect(page.getByText(/Synthetic internal policy/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve independently' })).toHaveCount(0)
  expect(submitted[0]).toMatchObject({ context_id: 5, axle_weights: ['8000','8000'], total_weight: '16000' })
  expect(submitted[0]).not.toHaveProperty('gvm_rating')
})
