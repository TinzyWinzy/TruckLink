import { test, expect } from '@playwright/test'

test('unreleased tenant lands on a scoped onboarding page and survives refresh', async ({ page }, testInfo) => {
  const writes: string[] = [], errors: string[] = []
  let selection: null | {version:number;modules:string[];required_modules:string[];created_at:string;status:string}=null
  const catalogue=[{key:'yard',name:'Yard control',description:'Arrivals and exits',requires:['inspection','release'],included:false},{key:'inspection',name:'Inspections',description:'Recorded checks',requires:['yard'],included:false},{key:'release',name:'Release safeguards',description:'Independent approval',requires:['inspection'],included:false},{key:'audit',name:'Audit history',description:'Included records',requires:[],included:true}]
  const user = {id:91,username:'TRK-SYNTH-ADMIN',role:'ADMIN',base_role:'ADMIN',organisation:{id:91,name:'Synthetic New Tenant',slug:'synthetic-new'},facilities:[{id:92,name:'Onboarding workspace',slug:'onboarding-workspace'}],tenant_configuration:{version:0,digest:'',release:null,modules:{yard:false,docks:false,fleet:false,routing:false,inspection:false,reports:false,audit:true},content:{schema_version:1,branding:{display_name:'Synthetic New Tenant',accent:'#2563eb',navy:'#101c30',paper:'#f4f6fa'},roles:{ADMIN:{enabled:true,label:'Administrator'}},permissions:{},workflow:{mandatory_checks:['driver-license'],inspection_max_age_seconds:86400,escalation_minutes:{FM:10,EXEC:30}},integrations:{}}}}
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**',async route => {
    const req=route.request(),path=new URL(req.url()).pathname
    if(path==='/api/auth/me/'&&!req.headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(path.startsWith('/api/auth/')){await route.fulfill({json:{token:'synthetic-only',user}});return}
    if(req.method()!=='GET')writes.push(path)
    if(path==='/api/tenant/subscription/'){
      if(req.method()==='POST'){
        const body=req.postDataJSON();expect(body.expected_version).toBe(selection?.version??0)
        selection={version:(selection?.version??0)+1,modules:body.modules,required_modules:['audit','inspection','release','yard'],created_at:'2026-10-08T00:00:00Z',status:'REQUESTED'}
      }
      await route.fulfill({status:req.method()==='POST'?201:200,json:{organisation:user.organisation,catalogue,selection,entitlement:{version:1,state:'ACTIVE',basis:'LEGACY_CONTINUITY',modules:['audit'],effective_from:'2026-10-08T00:00:00Z',effective_to:null},configured_modules:user.tenant_configuration.modules,effective_modules:user.tenant_configuration.modules,billing:{mode:'OPERATOR_APPROVED',prices_defined:false,checkout_available:false},unavailable:[]}});return
    }
    if(path==='/api/tenant/workspace/'){
      await route.fulfill({json:{organisation:user.organisation,facility:user.facilities[0],role:'ADMIN',as_of:'2026-10-08T00:00:00Z',activation_required:true,notice:'Scoped to the selected company and site.',cards:[{key:'audit',module:'audit',title:'Audit & history',description:'Retained records',href:'/audit'}]}});return
    }
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
  await page.getByRole('checkbox',{name:/Yard control/}).check()
  await page.getByRole('button',{name:'Save module request',exact:true}).click()
  await expect(page.getByText('Saved request v1',{exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:'Queue',exact:true})).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading',{name:'Client onboarding',exact:true})).toBeVisible()
  await expect(page.getByRole('checkbox',{name:/Yard control/})).toBeChecked()
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('onboarding-mobile.png'),fullPage:true})
  await page.goto('/workspace')
  await expect(page.getByRole('heading',{name:'Your workspace',exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:/Audit & history/})).toBeVisible()
  await expect(page.getByText('Operational activation is pending discovery and review.')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('workspace-mobile.png'),fullPage:true})
  expect(errors).toEqual([]);expect(writes).toEqual(['/api/tenant/subscription/'])
})
