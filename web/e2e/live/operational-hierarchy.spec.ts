import {test,expect} from '@playwright/test'
import {dashboardFixture} from './dashboard-fixtures'

// Synthetic contracts exercise presentation only. They are not customer performance.
test('reports prioritises handoffs and inspection reveals setup on demand at desktop and mobile sizes',async({page})=>{
  const user={id:91,username:'synthetic-ops',role:'OPERATIONS_SUPERVISOR',base_role:'OPERATIONS_SUPERVISOR',organisation:{id:91,name:'Synthetic Transport',slug:'synthetic'},facilities:[{id:92,name:'Synthetic Yard',slug:'synthetic-yard'}]}
  const entry={id:1,reg_number:'SYNTH-123',driver_name:'Synthetic Driver',cargo_type:'Synthetic cargo',expected_destination:'Synthetic destination',status:'QUARANTINED',entry_timestamp:new Date(Date.now()-100*60000).toISOString()}
  let holdBoard=false;let releaseBoard:()=>void=()=>{}
  const boardGate=new Promise<void>(resolve=>{releaseBoard=resolve})
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const writes:string[]=[]
  await page.route('**/api/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname
    if(request.method()!=='GET'&&!path.startsWith('/api/auth/'))writes.push(path)
    if(path==='/api/auth/me/'&&!request.headers().authorization){await route.fulfill({status:401,json:{}});return}
    let response:unknown={}
    if(path==='/api/auth/pin/')response={token:'synthetic-only',user}
    if(path==='/api/auth/me/')response={user}
    if(path==='/api/yard/board/'){if(holdBoard)await boardGate;response={queue:[entry],docks:[],alerts:[]}}
    if(path==='/api/reports/dashboard/'){if(holdBoard)await boardGate;const snapshot=dashboardFixture();snapshot.summary.blocked=1;snapshot.summary.mean_turnaround_minutes=null;snapshot.summary.physical_exits=0;response=snapshot}
    if(path==='/api/reports/export.csv'){await route.fulfill({contentType:'text/csv',body:'id,reg_number\r\n1,SYNTH-123'});return}
    if(path==='/api/operations/')response={as_of:new Date().toISOString(),docks:0,notice:'Synthetic presentation contract',movements:[{id:1,plate:entry.reg_number,status:entry.status,driver_name:entry.driver_name,age_minutes:100,trip_id:null,journey_linked:false,context_id:null,attempt_id:1,decision:'REVIEW_REQUIRED',blockers:[{code:'TRIP',title:'Link the dispatched trip',owner:'Dispatch Supervisor'}],next_action:{stage:'TRIP',label:'Link trip and load before inspection',href:'/dispatch?entry=1',owner_roles:['DISPATCH_SUPERVISOR'],assigned_person:null}}]}
    if(path==='/api/regulatory/queue/1/context/')response={mode:'VERSIONED',context:null,configuration:null,readiness_error:'Operational setup is incomplete',rulesets:[],attempt:{id:1,creator:9,decision:'REVIEW_REQUIRED',result:{controls:[{id:'context',status:'REVIEW_REQUIRED',reason:'Recorded context is missing',missing:['trip','load']}],readiness_percent:0,override_eligible:false,monetary_penalty:null,engine_version:'synthetic'}}}
    if(path==='/api/regulatory/queue/1/setup/')response={entry:{id:1,registration:entry.reg_number,status:entry.status},can_record_context:true,can_record_load:false,blockers:[{code:'TRIP',title:'Link the dispatched trip',owner:'Dispatch Supervisor'},{code:'RATINGS',title:'Review vehicle ratings',owner:'Independent compliance reviewer'}],trips:[],configurations:[],loads:[],evidence:[]}
    await route.fulfill({json:response})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/queue$/)
  holdBoard=true
  await page.goto('/reports')
  await expect(page.getByRole('region',{name:'Review priority'})).toContainText('Waiting for operational evidence')
  await expect(page.getByRole('button',{name:'Export CSV'})).toBeDisabled()
  await expect(page.getByText('No movements yet',{exact:true})).toHaveCount(0)
  releaseBoard()
  await expect(page.getByRole('region',{name:'Review priority'})).toContainText('1 movement needs controlled review')
  const worklist=page.getByRole('region',{name:'Role worklist'})
  await expect(worklist.getByText('SYNTH-123',{exact:true})).toBeVisible()
  await expect(worklist.getByRole('link',{name:'Open guided movement'})).toHaveAttribute('href','/dispatch?entry=1')
  expect((await worklist.getByRole('link',{name:'Open guided movement'}).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.emulateMedia({reducedMotion:'reduce'})
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto')
  const priorityBox=await worklist.boundingBox();const metricsBox=await page.getByText('Active in yard',{exact:true}).boundingBox()
  expect(priorityBox!.y).toBeLessThan(metricsBox!.y)
  await expect(page.getByText('No physical exits',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Export CSV'}).focus()
  expect(await page.getByRole('button',{name:'Export CSV'}).evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none')
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();expect((await download).suggestedFilename()).toMatch(/trk-turnaround.*csv/)
  await page.setViewportSize({width:1440,height:1000})
  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:'instant'})})
  await page.screenshot({path:'../docs/design/reports-hierarchy-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:1000})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'../docs/design/reports-hierarchy-mobile.png',fullPage:true})
  await page.goto('/compliance?entry=1')
  await expect(page.getByRole('heading',{name:'SYNTH-123'})).toBeVisible()
  await expect(page.getByText('Responsible role: Independent compliance reviewer')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Prepare this inspection'})).toHaveCount(0)
  await expect(page.getByLabel('Queue entry ID')).not.toBeVisible()
  await expect(page.getByLabel('Online',{exact:true})).toHaveCount(1)
  await expect(page.getByRole('button',{name:'Record versioned inspection'})).toHaveCount(0)
  await page.screenshot({path:'../docs/design/inspection-hierarchy-mobile.png',fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.setViewportSize({width:1440,height:1000})
  await page.screenshot({path:'../docs/design/inspection-hierarchy-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Complete operational setup'}).click()
  await expect(page.getByRole('heading',{name:'Prepare this inspection'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Save operational setup'})).toBeDisabled()
  await page.getByText('Recorded context and rule details',{exact:true}).click()
  await expect(page.getByLabel('Queue entry ID')).toBeVisible()
  await page.getByText('Evidence details',{exact:true}).click()
  await expect(page.getByText('Missing: trip, load')).toBeVisible()
  expect(writes).toEqual([]);expect(errors).toEqual([])
})

test('reports distinguishes a failed feed from an empty yard and recovers through retry',async({page})=>{
  let failed=true
  const user={id:91,username:'synthetic-ops',role:'OPERATIONS_SUPERVISOR',base_role:'OPERATIONS_SUPERVISOR',organisation:{id:91,name:'Synthetic Transport',slug:'synthetic'},facilities:[{id:92,name:'Synthetic Yard',slug:'synthetic-yard'}]}
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(['/api/yard/board/','/api/reports/dashboard/'].includes(path)&&failed){await route.fulfill({status:503,json:{detail:'Synthetic feed failure'}});return}
    const response=path.startsWith('/api/auth/')?{token:'synthetic-only',user}:path==='/api/reports/dashboard/'?dashboardFixture('24h',true):path==='/api/operations/'?{as_of:new Date().toISOString(),docks:0,movements:[],notice:'Synthetic'}:{queue:[],docks:[],alerts:[]}
    await route.fulfill({json:response})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/reports')
  await expect(page.getByRole('region',{name:'Review priority'})).toContainText('Operational data needs attention')
  await expect(page.getByRole('button',{name:'Export CSV'})).toBeDisabled()
  await expect(page.getByText('No movements yet',{exact:true})).toHaveCount(0)
  failed=false;await page.getByRole('button',{name:'Retry dashboard'}).click()
  await expect(page.getByText('No recorded arrivals or physical exits in this window.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Export CSV'})).toBeEnabled()
})
