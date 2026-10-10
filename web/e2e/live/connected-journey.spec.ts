import {test,expect} from '@playwright/test'

test('operations separates dock vacancy, exit and rejected delivery recovery on desktop and mobile',async ({page})=>{
  let stage='YARD_RELEASE_AUTHORISED'
  const events=[{id:'release:1',kind:stage,at:'2026-10-07T08:00:00Z',actor_id:5}]
  const nextKind=()=>stage==='YARD_RELEASE_AUTHORISED'?'DOCK_VACATED':stage==='DOCK_VACATED'?'DEPARTED':
    stage==='DEPARTED'||stage==='DELIVERY_REATTEMPT_PLANNED'?'DESTINATION_ARRIVED':
    stage==='DESTINATION_ARRIVED'?'DELIVERY_OUTCOME':stage==='DELIVERY_REJECTED'?'DELIVERY_REATTEMPT_PLANNED':null
  const journey=()=>({id:1,trip_id:3,visit_id:2,stage,yard_status:'RELEASED',dock:'Dock 1',events,
    milestone_semantics:'SEPARATE_V1',dock_occupied:stage==='YARD_RELEASE_AUTHORISED',
    next_action:{kind:nextKind(),label:nextKind()||'Reconcile evidence and ERP closure',owner_roles:['OPERATIONS_SUPERVISOR','FACILITY_MANAGER'],href:null,scope:null}})
  const user={id:42,username:'synthetic-ops',role:'OPERATIONS_SUPERVISOR',base_role:'OPERATIONS_SUPERVISOR',organisation:{id:42,name:'Disposable Transport',slug:'disposable'},facilities:[{id:84,name:'Disposable Yard',slug:'ci-yard'}]}
  const trip={id:3,origin:'Origin',destination:'Destination',status:'inquiry',synthetic:false,vehicle:{id:1,plate:'TEST-123'},driver:{id:1,name:'Synthetic Driver'},position:null,context:null,
    routing:{stops:[],geometry:null,distance_km:null,duration_hours:null,provider:'No road route',jurisdictions:['TEST'],regulatory_clearance:'NOT_EVALUATED'}}
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    let response:unknown={}
    if(path==='/api/auth/pin/') response={token:'synthetic-only',user}
    if(path==='/api/auth/me/') response={user}
    if(path==='/api/yard/board/') response={queue:[{id:2,reg_number:'TEST-123',driver_name:'Synthetic Driver',status:'RELEASED',milestone_semantics:'SEPARATE_V1',journey_trip_id:3,entry_timestamp:'2026-10-07T08:00:00Z',exit_timestamp:null}],alerts:[],docks:[]}
    if(path==='/api/routes/workspace/') response={trips:[trip],vehicles:[],drivers:[],visits:[],can_save:true,organisation:user.organisation,facility:user.facilities[0]}
    if(path==='/api/trips/3/journey/') response={journey:journey()}
    if(path==='/api/trips/3/journey/events/'){
      const body=route.request().postDataJSON()
      const expected=nextKind()
      if(expected==='DELIVERY_OUTCOME') {
        expect(['DELIVERY_ACCEPTED','DELIVERY_REJECTED']).toContain(body.kind)
        expect(body.details).toMatchObject({receiver:'Test receiver',evidence_reference:'test://receipt',evidence_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
      } else expect(body.kind).toBe(expected)
      stage=body.kind; events.push({id:`event:${events.length}`,kind:stage,at:body.observed_at,actor_id:42})
      response={journey:journey()}
    }
    await route.fulfill({json:response})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS')
  await page.getByLabel('PIN',{exact:true}).fill('112233')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page.getByText('Release authorised. Awaiting gate exit.')).toBeVisible()
  await page.getByRole('link',{name:'Journey 3 →',exact:true}).click()
  const panel=page.getByRole('region',{name:'Connected journey'})
  await expect(panel.getByText('YARD RELEASE AUTHORISED',{exact:true})).toBeVisible()
  for(const action of ['Record dock vacated','Record departed','Record destination arrived']){
    await panel.getByLabel('Observation reason').fill('Synthetic staff observation')
    await panel.getByRole('button',{name:action,exact:true}).click()
    await expect(panel.getByLabel('Observation reason')).toHaveValue('')
  }
  await page.setViewportSize({width:390,height:1000})
  await panel.getByLabel('Delivery outcome').selectOption('DELIVERY_REJECTED')
  await panel.getByLabel('Observation reason').fill('Synthetic rejection and agreed recovery')
  await panel.getByLabel('Receiver name').fill('Test receiver')
  await panel.getByLabel('Delivery evidence reference').fill('test://receipt')
  await panel.getByLabel('Fingerprint delivery document').setInputFiles({name:'rejection.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic rejection receipt')})
  await panel.getByRole('button',{name:'Record delivery rejected'}).click()
  await expect(panel.getByLabel('Observation reason')).toHaveValue('')
  await panel.getByLabel('Observation reason').fill('Receiver agreed reattempt at same destination')
  await panel.getByRole('button',{name:'Record delivery reattempt planned'}).click()
  await expect(panel.getByLabel('Observation reason')).toHaveValue('')
  await panel.getByLabel('Observation reason').fill('Arrived for agreed reattempt')
  await panel.getByRole('button',{name:'Record destination arrived'}).click()
  await expect(panel.getByLabel('Observation reason')).toHaveValue('')
  await panel.getByLabel('Observation reason').fill('Synthetic receiver acceptance')
  await expect(panel.getByRole('button',{name:'Record delivery accepted'})).toBeDisabled()
  await panel.getByLabel('Receiver name').fill('Test receiver')
  await panel.getByLabel('Delivery evidence reference').fill('test://receipt')
  await panel.getByLabel('Fingerprint delivery document').setInputFiles({name:'receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic delivery receipt')})
  await panel.getByRole('button',{name:'Record delivery accepted'}).click()
  await expect(panel.getByText('DELIVERY ACCEPTED',{exact:true})).toBeVisible()
  await expect(panel.getByText(/commercial closure are not confirmed/)).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
