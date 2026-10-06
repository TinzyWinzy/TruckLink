import { test, expect } from '@playwright/test'

test('a second tenant edits its branding and workflow without a BAK default', async ({ page }) => {
  const roles = Object.fromEntries(['ADMIN','DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','EXECUTIVE','COMPLIANCE_OFFICER'].map(role => [role,{ label: role.replace(/_/g,' '), enabled: true }]))
  let config = { version: 2, digest: 'synthetic-fixture', content: { schema_version: 1,
    branding: { display_name: 'Northstar Transport', accent: '#2563eb', navy: '#123456', paper: '#f4f6fa' },
    roles, permissions: {}, workflow: { mandatory_checks: ['driver-license'], inspection_max_age_seconds: 3600, escalation_minutes: { FM:10,EXEC:30 } }, integrations: {} } }
  const user = () => ({ id:42,username:'synthetic-northstar-admin',role:'ADMIN',base_role:'ADMIN',organisation:{id:42,name:'Northstar Transport',slug:'northstar'},facilities:[{id:84,name:'Northstar Yard',slug:'northstar-yard'}],tenant_configuration:config })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me/' && !route.request().headers().authorization) {
      await route.fulfill({ status:401,json:{detail:'Synthetic signed-out session'} })
      return
    }
    let response: unknown = {}
    if (path === '/api/auth/pin/') response = { token:'synthetic-only',user:user() }
    if (path === '/api/auth/me/') response = { user:user() }
    if (path === '/api/tenant/configuration/') {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON()
        expect(input.expected_version).toBe(2)
        expect(input.reason).toBe('Northstar workflow update')
        expect(input.content.branding.display_name).toBe('Northstar Freight')
        expect(input.content.integrations).toEqual({})
        config = { version:3,digest:'synthetic-revision',content:input.content }
      }
      response = { configuration:config }
    }
    await route.fulfill({ json:response })
  })
  await page.goto('/')
  await page.getByLabel('Staff ID', { exact:true }).fill('SYNTHETIC-NORTHSTAR')
  await page.getByLabel('PIN', { exact:true }).fill('112233')
  await page.getByRole('button', { name:'Sign in to shift',exact:true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByRole('link', { name:'Admin',exact:true }).click()
  await expect(page.getByLabel('Tenant display name')).toHaveValue('Northstar Transport')
  await page.getByLabel('Tenant display name').fill('Northstar Freight')
  await page.getByLabel('Label for DISPATCH_SUPERVISOR').fill('Load Controller')
  await page.getByLabel('Reason for change').fill('Northstar workflow update')
  await page.getByRole('button', { name:'Save tenant configuration' }).click()
  await expect(page.getByText('Tenant configuration saved as version 3')).toBeVisible()
  await expect(page.getByRole('banner')).toContainText('Northstar Freight')
  await expect(page.getByLabel('Switch working role').getByRole('option', { name:'Load Controller' })).toHaveCount(1)
  expect(await page.locator('body').innerText()).not.toContain('BAK')
  await page.reload()
  await expect(page.getByLabel('Tenant display name')).toHaveValue('Northstar Freight')
  expect(await page.locator('body').innerText()).not.toContain('BAK')
})
