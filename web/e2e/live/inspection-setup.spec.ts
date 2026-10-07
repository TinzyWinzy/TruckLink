import {test,expect} from '@playwright/test'

test('operations resolves missing context without treating setup as inspection approval',async({page})=>{
  let recorded=false
  const user={id:42,username:'synthetic-ops',role:'OPERATIONS_SUPERVISOR',base_role:'OPERATIONS_SUPERVISOR',organisation:{id:42,name:'Disposable Transport',slug:'disposable'},facilities:[{id:84,name:'Disposable Yard',slug:'ci-yard'}]}
  const context={id:7,driver:4,trip:2,load:6,route_type:'DOMESTIC',jurisdictions:['TEST'],origin:'Origin',destination:'Destination'}
  const configuration={id:5,vehicle:3,revision:1,vehicle_class:'Test Truck',rated_axle_kg:['5000','5000'],rated_gross_kg:'10000',review_status:'REVIEWED',usable:true}
  const attempt={id:1,creator:9,decision:'REVIEW_REQUIRED',result:{controls:[{id:'context',status:'REVIEW_REQUIRED',reason:'Recorded context is missing'}],readiness_percent:0,engine_version:'nrok-1',override_eligible:false,monetary_penalty:null}}
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    let response:unknown={}
    if(path==='/api/auth/pin/')response={token:'synthetic-only',user}
    if(path==='/api/auth/me/')response={user}
    if(path==='/api/regulatory/queue/1/context/'){
      if(route.request().method()==='POST'){
        expect(route.request().postDataJSON()).toEqual({configuration:5,trip:2,driver:4,load:6,route_type:'DOMESTIC',jurisdictions:['TEST'],origin:'Origin',destination:'Destination',evidence_ids:[]})
        recorded=true
      }
      response={mode:'VERSIONED',context:recorded?context:null,configuration:recorded?configuration:null,readiness_error:recorded?null:'Operational setup is incomplete.',rulesets:[],attempt}
    }
    if(path==='/api/regulatory/queue/1/setup/')response={entry:{id:1,registration:'TEST-123',status:'AT_DOCK'},can_record_context:true,can_record_load:true,blockers:[],configurations:[configuration],loads:[{id:6,reference:'MANIFEST-1',cargo_class:'GENERAL',declared_mass_kg:'1000'}],evidence:[],trips:[{id:2,vehicle:3,driver:4,driver_name:'Test Driver',origin:'Origin',destination:'Destination',routing_snapshot:{route_type:'DOMESTIC',jurisdictions:['TEST']}}]}
    await route.fulfill({json:response})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS');await page.getByLabel('PIN',{exact:true}).fill('112233')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/compliance?entry=1')
  await page.getByRole('button',{name:'Complete operational setup'}).click()
  await expect(page.getByRole('heading',{name:'Prepare this inspection'})).toBeVisible()
  await expect(page.getByText(/Setup prevented this inspection/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Record versioned inspection'})).toHaveCount(0)
  await page.screenshot({path:'../docs/design/inspection-setup-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:1000})
  await page.getByLabel('Assigned trip').selectOption('2')
  await page.getByLabel('Reviewed vehicle configuration').selectOption('5')
  await page.getByRole('combobox',{name:/^Load/}).selectOption('6')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'../docs/design/inspection-setup-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Save operational setup'}).click()
  await expect(page.getByText(/Operational setup saved/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Record versioned inspection'})).toBeDisabled()
  await expect(page.getByText(/Dispatch Supervisor records measured mass/)).toBeVisible()
  await expect(page.getByRole('heading',{name:'Inspection 1 · REVIEW_REQUIRED'})).toBeVisible()
  expect(errors).toEqual([])
})
