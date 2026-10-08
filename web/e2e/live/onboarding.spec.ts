import { test, expect } from '@playwright/test'

test('unreleased tenant lands on a scoped onboarding page and survives refresh', async ({ page }, testInfo) => {
  const writes: string[] = [], errors: string[] = []
  const user = {id:91,username:'TRK-SYNTH-ADMIN',role:'ADMIN',base_role:'ADMIN',organisation:{id:91,name:'Synthetic New Tenant',slug:'synthetic-new'},facilities:[{id:92,name:'Onboarding workspace',slug:'onboarding-workspace'}],tenant_configuration:{version:0,digest:'',release:null,modules:{yard:false,docks:false,fleet:false,routing:false,inspection:false,reports:false,audit:true},content:{schema_version:1,branding:{display_name:'Synthetic New Tenant',accent:'#2563eb',navy:'#101c30',paper:'#f4f6fa'},roles:{ADMIN:{enabled:true,label:'Administrator'}},permissions:{},workflow:{mandatory_checks:['driver-license'],inspection_max_age_seconds:86400,escalation_minutes:{FM:10,EXEC:30}},integrations:{}}}}
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**',async route => {
    const req=route.request(),path=new URL(req.url()).pathname
    if(path==='/api/auth/me/'&&!req.headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(path.startsWith('/api/auth/')){await route.fulfill({json:{token:'synthetic-only',user}});return}
    if(req.method()!=='GET')writes.push(path)
    await route.fulfill({json:{alerts:[],records:[]}})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('TRK-SYNTH-ADMIN')
  await page.getByLabel('PIN',{exact:true}).fill('93472581')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByRole('heading',{name:'Client onboarding',exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Activation status'})).toContainText('Synthetic New Tenant')
  await expect(page.getByText('Workspace created. Operational setup pending.',{exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:'Reports',exact:true})).toHaveCount(0)
  await expect(page.getByRole('link',{name:'Queue',exact:true})).toHaveCount(0)
  await expect(page.getByRole('link',{name:'Open tenant configuration',exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{name:'Client onboarding',exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('onboarding-mobile.png'),fullPage:true})
  expect(errors).toEqual([]);expect(writes).toEqual([])
})
