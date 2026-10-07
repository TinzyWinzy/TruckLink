import {test,expect} from '@playwright/test'

test('operations follows release, departure, arrival and evidenced delivery on desktop and mobile',async ({page})=>{
  let stage='YARD_RELEASE_AUTHORISED'
  const events=[{id:'release:1',kind:stage,at:'2026-10-07T08:00:00Z',actor_id:5}]
  const journey=()=>({id:1,trip_id:3,visit_id:2,stage,yard_status:'RELEASED',dock:'Dock 1',events})
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
    if(path==='/api/routes/workspace/') response={trips:[trip],vehicles:[],drivers:[],visits:[],can_save:true,organisation:user.organisation,facility:user.facilities[0]}
    if(path==='/api/trips/3/journey/') response={journey:journey()}
    if(path==='/api/trips/3/journey/events/'){
      const body=route.request().postDataJSON()
      const expected=stage==='YARD_RELEASE_AUTHORISED'?'DEPARTED':stage==='DEPARTED'?'DESTINATION_ARRIVED':'DELIVERY_ACCEPTED'
      expect(body.kind).toBe(expected)
      if(expected==='DELIVERY_ACCEPTED') expect(body.details).toMatchObject({receiver:'Test receiver',evidence_reference:'test://receipt',evidence_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
      stage=body.kind; events.push({id:`event:${events.length}`,kind:stage,at:body.observed_at,actor_id:42})
      response={journey:journey()}
    }
    await route.fulfill({json:response})
  })
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC-OPS')
  await page.getByLabel('PIN',{exact:true}).fill('112233')
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await page.getByRole('link',{name:'Routes & map',exact:true}).click()
  await page.getByRole('button',{name:/TEST-123/}).click()
  const panel=page.getByRole('region',{name:'Connected journey'})
  await expect(panel.getByText('YARD RELEASE AUTHORISED',{exact:true})).toBeVisible()
  for(const action of ['Record departed','Record destination arrived']){
    await panel.getByLabel('Observation reason').fill('Synthetic staff observation')
    await panel.getByRole('button',{name:action,exact:true}).click()
  }
  await page.setViewportSize({width:390,height:1000})
  await panel.getByLabel('Observation reason').fill('Synthetic receiver acceptance')
  await expect(panel.getByRole('button',{name:'Record delivery accepted'})).toBeDisabled()
  await panel.getByLabel('Receiver name').fill('Test receiver')
  await panel.getByLabel('Delivery evidence reference').fill('test://receipt')
  await panel.getByLabel('Fingerprint delivery document').setInputFiles({name:'receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic delivery receipt')})
  await panel.getByRole('button',{name:'Record delivery accepted'}).click()
  await expect(panel.getByText('DELIVERY ACCEPTED',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
