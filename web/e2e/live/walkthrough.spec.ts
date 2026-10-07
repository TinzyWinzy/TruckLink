import {test,expect} from '@playwright/test'

test('assigned reviewer can navigate readiness and all-role walkthrough on mobile',async({page})=>{
  const user={id:42,username:'synthetic-ops',role:'OPERATIONS_SUPERVISOR',base_role:'OPERATIONS_SUPERVISOR',organisation:{id:42,name:'Disposable Transport',slug:'disposable'},facilities:[{id:84,name:'Disposable Yard',slug:'ci-yard'}]}
  const writes:string[]=[]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(route.request().method()!=='GET'&&path!=='/api/auth/pin/')writes.push(path)
    let response:unknown={}
    if(path==='/api/auth/pin/')response={token:'synthetic-only',user}
    if(path==='/api/auth/me/')response={user}
    if(path==='/api/yard/board/')response={queue:[],alerts:[],docks:[]}
    if(path==='/api/walkthrough/'){
      expect(new URL(route.request().url()).searchParams.get('facility')).toBe('84')
      response={counts:{vehicles:0,drivers:0,loads:0,configuration_records:0,visits:1,linked_journeys:0},visits:[{id:2,plate:'TEST-123',status:'QUARANTINED'}],integrations:{erp:'NOT_CONFIGURED',tracker:'NOT_CONFIGURED'},notice:'Counts do not establish release eligibility.'}
    }
    await route.fulfill({json:response})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS')
  await page.getByLabel('PIN',{exact:true}).fill('112233')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await page.goto('/guide')
  await expect(page.getByRole('heading',{name:'Operational walkthrough'})).toBeVisible()
  await expect(page.getByText('Counts do not establish release eligibility.')).toBeVisible()
  await page.getByLabel('Inspect an existing visit').selectOption('2')
  await expect(page.getByRole('link',{name:'Open visit inspection'})).toHaveAttribute('href','/compliance?entry=2')
  await page.getByLabel('Show responsibility').selectOption('OPERATIONS_SUPERVISOR')
  await page.setViewportSize({width:390,height:1000})
  await expect(page.getByRole('heading',{name:'Authorise and receive rejected consignments'})).toBeVisible()
  await page.getByRole('button',{name:'Mark reviewed'}).first().click()
  await expect(page.getByRole('button',{name:'Reviewed',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(writes).toEqual([])
})

test('shareable external practice walkthrough opens without tenant API traffic',async({page})=>{
  const writes:string[]=[]
  await page.route('**/api/**',async route=>{writes.push(route.request().url());await route.fulfill({status:401,json:{detail:'No tenant access'}})})
  await page.goto('/?demo=1&role=admin&walkthrough=1')
  await expect(page).toHaveURL(/\/guide$/)
  await expect(page.getByRole('heading',{name:'Platform practice review'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Current site readiness'})).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading',{name:'Operational walkthrough'})).toBeVisible()
  expect(writes).toEqual([])
})
