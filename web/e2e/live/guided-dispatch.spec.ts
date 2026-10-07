import {test,expect} from '@playwright/test'

test('guided dispatch connects setup, inspection, release and physical exit',async({page})=>{
  let saved=false;let status='AT_DOCK';let departed=false;let attempt:unknown=null
  const user={id:42,username:'synthetic-dispatch',role:'DISPATCH_SUPERVISOR',base_role:'DISPATCH_SUPERVISOR',organisation:{id:42,name:'Synthetic Training Transport',slug:'synthetic'},facilities:[{id:84,name:'Synthetic Yard',slug:'ci-yard'}]}
  const configuration={id:5,vehicle:3,revision:1,vehicle_class:'Synthetic truck',rated_axle_kg:['5000','5000'],rated_gross_kg:'10000',review_status:'REVIEWED',usable:true}
  const context={id:7,driver:4,trip:2,load:6,route_type:'DOMESTIC',jurisdictions:['TEST'],origin:'Synthetic origin',destination:'Synthetic destination'}
  const trip={id:2,origin:context.origin,destination:context.destination,status:'inquiry',vehicle:{id:3,plate:'SYNTH-123'},driver:{id:4,name:'Synthetic Driver'},routing:{stops:[],geometry:null,jurisdictions:['TEST']},context:{queue_entry:1},position:null}
  const journey=()=>({id:1,trip_id:2,visit_id:1,stage:departed?'DEPARTED':'YARD_RELEASE_AUTHORISED',yard_status:status,events:[],milestone_semantics:'SEPARATE_V1',dock_occupied:false,next_action:{kind:departed?'DESTINATION_ARRIVED':'DEPARTED',label:departed?'Record arrival':'Record gate exit',owner_roles:departed?['OPERATIONS_SUPERVISOR']:['DISPATCH_SUPERVISOR']}})
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let response:unknown={}
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(path==='/api/auth/pin/')response={token:'synthetic-only',user}
    if(path==='/api/auth/me/')response={user}
    if(path==='/api/yard/board/')response={queue:[],alerts:[],docks:[]}
    if(path==='/api/operations/')response={as_of:'2026-10-07T08:00:00Z',movements:[{id:1,plate:'SYNTH-123',driver_name:'Synthetic Driver',status,age_minutes:15,trip_id:2,journey_linked:true,context_id:saved?7:null,attempt_id:attempt?1:null,blockers:[],next_action:{stage:departed?'JOURNEY':status==='RELEASED'?'EXIT':status==='COMPLETED'?'RELEASE':saved?'INSPECTION':'SETUP',label:saved?'Continue synthetic dispatch':'Select trip, load and route context',owner_roles:['DISPATCH_SUPERVISOR'],assigned_person:null}}],docks:1,notice:'Synthetic contract only'}
    if(path==='/api/docks/')response={docks:[{id:1,name:'Synthetic Dock',status:'AVAILABLE',current_entry:null}]}
    if(path==='/api/regulatory/queue/1/setup/')response={entry:{id:1,registration:'SYNTH-123',status},can_record_context:true,can_record_load:false,blockers:[],trips:[{id:2,driver:4,vehicle:3,driver_name:'Synthetic Driver',origin:context.origin,destination:context.destination,routing_snapshot:{route_type:'DOMESTIC',jurisdictions:['TEST']}}],configurations:[configuration],loads:[{id:6,reference:'SYNTH-MANIFEST',cargo_class:'GENERAL',declared_mass_kg:'1000'}],evidence:[]}
    if(path==='/api/regulatory/queue/1/context/'){
      if(route.request().method()==='POST'){saved=true;expect(route.request().postDataJSON().trip).toBe(2)}
      response={mode:'VERSIONED',context:saved?context:null,configuration:saved?configuration:null,readiness_error:saved?null:'Synthetic setup missing',rulesets:[],attempt}
    }
    if(path==='/api/regulatory/evaluate/'){const body=route.request().postDataJSON();expect(body.axle_weights).toEqual(['1000','1000']);expect(body.context_id).toBe(7);status='COMPLETED';attempt={id:1,creator:42,decision:'PASS',result:{readiness_percent:100,controls:[],override_eligible:false,monetary_penalty:null,engine_version:'synthetic-contract'}};response={attempt,replayed:false}}
    if(path==='/api/queue/1/release/'){expect(status).toBe('COMPLETED');status='RELEASED';response={ok:true}}
    if(path==='/api/routes/workspace/')response={trips:[trip],vehicles:[],drivers:[],visits:[],can_save:true,organisation:user.organisation,facility:user.facilities[0]}
    if(path==='/api/trips/2/journey/')response={journey:journey()}
    if(path==='/api/trips/2/journey/events/'){expect(status).toBe('RELEASED');expect(route.request().postDataJSON().kind).toBe('DEPARTED');departed=true;response={journey:journey()}}
    await route.fulfill({json:response})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-DISPATCH');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page).toHaveURL(/\/queue$/);await page.goto('/dispatch?entry=1')
  await expect(page.getByRole('heading',{name:'Guided dispatch'})).toBeVisible();await expect(page.getByText('Assigned person: unassigned.',{exact:false})).toBeVisible()
  await page.getByRole('combobox',{name:'Assigned trip',exact:true}).selectOption('2');await page.getByLabel('Reviewed vehicle configuration').selectOption('5');await page.getByRole('combobox',{name:/^Load$/}).selectOption('6')
  await page.screenshot({path:'../docs/design/guided-dispatch-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Save operational setup'}).click();await expect(page.getByRole('heading',{name:'Operational gate inspection'})).toBeVisible()
  await page.getByLabel('Axle 1',{exact:true}).fill('1000');await page.getByLabel('Axle 2',{exact:true}).fill('1000');await page.getByLabel('Total',{exact:true}).fill('2000');for(const box of await page.getByRole('checkbox').all())await box.check()
  await page.getByRole('button',{name:'Record versioned inspection'}).click();await expect(page.getByRole('heading',{name:'Separate release decision'})).toBeVisible()
  await page.getByRole('button',{name:'Authorise yard release'}).click();await expect(page.getByRole('region',{name:'Connected journey'})).toBeVisible()
  await page.setViewportSize({width:390,height:1000});await page.getByLabel('Observation reason').fill('Synthetic physical exit observed');await page.screenshot({path:'../docs/design/guided-dispatch-mobile.png',fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Record departed',exact:true}).click();await expect(page.getByText('DEPARTED · Yard: RELEASED')).toBeVisible();expect(saved&&departed).toBe(true);expect(errors).toEqual([])
})


test('offline observed arrival recovers once after reconnection',async({page,context})=>{
  const user={id:43,username:'synthetic-offline',role:'DISPATCH_SUPERVISOR',base_role:'DISPATCH_SUPERVISOR',organisation:{id:43,name:'Isolated offline test',slug:'offline'},facilities:[{id:85,name:'Training Yard',slug:'offline-yard'}]}
  const submissions:Record<string,unknown>[]=[]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let response:unknown={}
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(path==='/api/auth/pin/')response={token:'synthetic-only',user}
    if(path==='/api/auth/me/')response={user}
    if(path==='/api/operations/')response={as_of:'2026-10-07T08:00:00Z',movements:[],docks:0,notice:'Synthetic contract only'}
    if(path==='/api/yard/board/')response={queue:[],alerts:[],docks:[]}
    if(path==='/api/queue/'&&route.request().method()==='POST'){submissions.push(route.request().postDataJSON());response={ok:true,queue_entry:{id:1}}}
    await route.fulfill({json:response})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OFFLINE');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/dispatch');await page.getByText('Register an observed arrival',{exact:true}).click();await page.getByLabel('Arrival vehicle registration').fill('SYNTH-999');await page.getByLabel('Arrival driver').fill('Synthetic Driver');await page.getByLabel('Arrival cargo').fill('Synthetic cartons');await page.getByLabel('Arrival destination').fill('Synthetic destination')
  await context.setOffline(true);await page.getByRole('button',{name:'Register observed arrival',exact:true}).click();await expect(page.getByText(/Arrival saved offline/)).toBeVisible();expect(submissions).toHaveLength(0)
  await context.setOffline(false);await expect.poll(()=>submissions.length).toBe(1);expect(submissions[0].reg_number).toBe('SYNTH-999');expect(submissions[0].idempotency_key).toMatch(/^q-/)
  await page.reload();await expect(page.getByRole('heading',{name:'Guided dispatch'})).toBeVisible();await expect(page.getByText(/pending sync/)).toHaveCount(0);expect(submissions).toHaveLength(1)
})
