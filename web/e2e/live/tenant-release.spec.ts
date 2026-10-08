import { test, expect } from '@playwright/test'

test('configuration authoring, publication and activation update module navigation separately',async ({ page }) => {
  const modules = {yard:true,docks:true,inspection:true,release:true,fleet:true,routing:true,notifications:true,reports:true,modelling:true,audit:true}
  const roles = Object.fromEntries(['ADMIN','DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','EXECUTIVE','COMPLIANCE_OFFICER'].map(role => [role,{label:role.replace(/_/g,' '),enabled:true}]))
  let config = { id:1,version:1,digest:'synthetic',modules:{...modules},release:{id:1,version:1,digest:'synthetic-release'},content:{schema_version:1,
    branding:{display_name:'Disposable Transport',accent:'#2563eb',navy:'#101c30',paper:'#f4f6fa'},roles,permissions:{},
    workflow:{mandatory_checks:['driver-license'],inspection_max_age_seconds:3600,escalation_minutes:{FM:10,EXEC:30}},integrations:{}} }
  const revisions = [{id:1,kind:'MODULES',key:'capabilities',version:1,content:{...modules},facility_id:null},
    {id:2,kind:'WORKFLOW',key:'yard',version:1,content:{},facility_id:null}]
  const releases = [{id:1,version:1,configuration_id:1,artifact_ids:[1,2]}]
  let active = releases[0]; let activationVersion = 1
  const user = () => ({id:42,username:'synthetic-admin',role:'ADMIN',base_role:'ADMIN',organisation:{id:42,name:'Disposable Transport',slug:'disposable'},facilities:[{id:84,name:'Disposable Yard',slug:'disposable-yard'}],tenant_configuration:config})
  const errors:string[] = []; page.on('pageerror',e => errors.push(e.message))
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me/' && !route.request().headers().authorization) { await route.fulfill({status:401,json:{}}); return }
    let response:unknown = {}
    if (path === '/api/docks/') response = {docks:[]}
    if (path === '/api/auth/pin/') response = {token:'synthetic-only',user:user()}
    if (path === '/api/auth/me/') response = {user:user()}
    if (path === '/api/tenant/configuration/') response = {configuration:config}
    if (path === '/api/tenant/registry/') response = {modules:Object.fromEntries(Object.keys(modules).map(k => [k,[]])),release:active,activation_version:activationVersion}
    if (path === '/api/tenant/revisions/') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); expect(body.expected_version).toBe(1); expect(body.content.routing).toBe(false)
        revisions.push({id:3,kind:'MODULES',key:'capabilities',version:2,content:body.content,facility_id:null})
      }
      response = {revisions}
    }
    if (path === '/api/tenant/releases/') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); expect(body.artifact_ids).toEqual([2,3]); expect(body.expected_version).toBe(1)
        releases.push({id:2,version:2,configuration_id:1,artifact_ids:body.artifact_ids})
      }
      response = {releases}
    }
    if (path === '/api/tenant/releases/2/activate/') {
      const body = route.request().postDataJSON(); expect(body.expected_version).toBe(1)
      active = releases[1]; activationVersion = 2
      config = {...config,modules:{...modules,routing:false},release:{id:2,version:2,digest:'synthetic-revision'}}
      response = {activation:{id:2,version:2}}
    }
    await route.fulfill({json:response})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-ONLY')
  await page.getByLabel('PIN',{exact:true}).fill('112233')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByRole('link',{name:'Admin',exact:true}).click()
  await page.getByRole('button',{name:'MODULES · capabilities · v1 · #1',exact:true}).click()
  await page.getByRole('checkbox',{name:'routing',exact:true}).uncheck()
  await page.getByLabel('Release change reason').fill('Synthetic module test')
  await page.getByRole('button',{name:'Save configuration revision',exact:true}).click()
  await expect(page.getByText('Configuration revision saved.',{exact:false})).toBeVisible()
  await expect(page.getByRole('link',{name:'Routes & map',exact:true})).toBeVisible()
  await page.getByLabel('Include revision 1',{exact:true}).uncheck()
  await page.getByLabel('Include revision 3',{exact:true}).check()
  await page.getByRole('button',{name:'Publish tenant release',exact:true}).click()
  await expect(page.getByText('Release published.',{exact:false})).toBeVisible()
  await expect(page.getByRole('link',{name:'Routes & map',exact:true})).toBeVisible()
  await page.getByLabel('Release to activate').selectOption('2')
  await page.getByRole('button',{name:'Activate tenant release',exact:true}).click()
  await expect(page.getByText('Tenant release activated.',{exact:false})).toBeVisible()
  await expect(page.getByRole('link',{name:'Routes & map',exact:true})).toHaveCount(0)
  await expect(page.getByText('routing: disabled',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:1000})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path:'../docs/design/tenant-release-synthetic-mobile.png',fullPage:true})
  expect(errors).toEqual([])
})
