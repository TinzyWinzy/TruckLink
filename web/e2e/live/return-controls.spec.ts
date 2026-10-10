import {test,expect} from '@playwright/test'
test('operations records an authorised return through receiving visit and retained receipt on mobile',async({page})=>{
  const user={id:42,username:'synthetic-ops',role:'OPERATIONS_SUPERVISOR',base_role:'OPERATIONS_SUPERVISOR',organisation:{id:42,name:'Disposable Transport',slug:'disposable'},facilities:[{id:84,name:'Disposable Yard',slug:'ci-yard'}]}
  let state='RETURN_AUTHORISED';const commands:string[]=[]
  const trip={id:3,origin:'Origin',destination:'Final',status:'in_transit',synthetic:false,vehicle:{id:1,plate:'TEST-123'},driver:{id:1,name:'Synthetic Driver'},position:null,context:null,routing:{stops:[],geometry:null,distance_km:null,duration_hours:null,provider:'No road route',jurisdictions:['TEST'],regulatory_clearance:'NOT_EVALUATED'}}
  const journey=()=>({id:1,trip_id:3,visit_id:2,stage:state==='RETURN_RECEIVED'?'COMPLETED_WITH_RETURNS':'STOPS_COMPLETE_RETURNS_OPEN',yard_status:'RELEASED',dock:null,events:[{id:'departure:1',kind:'DEPARTED',at:'2026-10-07T08:00:00Z',actor_id:42}],
    itinerary:['First','Final'],active_stop_index:null,can_withdraw_release:false,
    next_action:{kind:null,label:'Complete authorised returns',owner_roles:['OPERATIONS_SUPERVISOR'],href:null,scope:null},
    delivery_stops:[{index:0,label:'First',consignments:[{reference:'ORDER-1',quantity:'10',unit:'cartons'}],state:'DELIVERY_REJECTED',return_order_id:7,resolved:true},{index:1,label:'Final',consignments:[],state:'DELIVERY_ACCEPTED',return_order_id:null,resolved:true}],
    returns:[{id:7,facility_id:84,facility_name:'Disposable Yard',state,reason:'Rejected full consignment',consignments:[],route_reference:'test://route'}],receiving_visits:[{id:9,facility_id:84,reg_number:'TEST-123'}]})
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let response:unknown={}
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(path==='/api/auth/pin/')response={token:'synthetic-only',user}
    if(path==='/api/auth/me/')response={user}
    if(path==='/api/yard/board/')response={queue:[],docks:[],alerts:[]}
    if(path==='/api/routes/workspace/')response={trips:[trip],vehicles:[],drivers:[],visits:[],can_save:true,organisation:user.organisation,facility:user.facilities[0]}
    if(path==='/api/trips/3/journey/')response={journey:journey()}
    if(path==='/api/trips/3/journey/events/'){
      const body=route.request().postDataJSON()
      expect(body.return_order_id).toBe(7)
      if(body.kind==='RETURN_ARRIVED')expect(body.receiving_visit_id).toBe(9)
      if(body.kind==='RETURN_RECEIVED')expect(body.details).toMatchObject({receiver:'Test warehouse receiver',evidence_reference:'test://return-receipt',evidence_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
      commands.push(body.kind);state=body.kind;response={journey:journey()}
    }
    await route.fulfill({json:response})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS');await page.getByLabel('PIN',{exact:true}).fill('112233')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/routes?trip=3');await page.setViewportSize({width:390,height:1000})
  const panel=page.getByRole('region',{name:'Connected journey'})
  await panel.getByLabel('Return to update').selectOption('7')
  await panel.getByLabel('Operation reason').fill('Synthetic return departure')
  await panel.getByRole('button',{name:'Record return in transit'}).click()
  await expect(panel.getByLabel('Operation reason')).toHaveValue('')
  await panel.getByLabel('Operation reason').fill('Synthetic receiving yard arrival')
  await expect(panel.getByRole('button',{name:'Record return arrived'})).toBeDisabled()
  await panel.getByLabel('Receiving yard visit').selectOption('9')
  await panel.getByRole('button',{name:'Record return arrived'}).click()
  await expect(panel.getByLabel('Operation reason')).toHaveValue('')
  await panel.getByLabel('Operation reason').fill('Synthetic warehouse receipt')
  await panel.getByLabel('Return receiver').fill('Test warehouse receiver')
  await panel.getByLabel('Return receipt reference').fill('test://return-receipt')
  await panel.getByLabel('Fingerprint return receipt').setInputFiles({name:'return.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic return receipt')})
  await panel.getByRole('button',{name:'Record return received'}).click()
  await expect(panel.getByText(/Physical execution completed with returns/)).toBeVisible()
  expect(commands).toEqual(['RETURN_IN_TRANSIT','RETURN_ARRIVED','RETURN_RECEIVED'])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
