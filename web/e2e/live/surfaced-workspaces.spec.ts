import {test,expect,type Page} from '@playwright/test'

const trip={id:3,origin:'Synthetic origin',destination:'Synthetic destination',status:'inquiry',synthetic:false,vehicle:{id:1,plate:'SYNTH-123'},driver:{id:2,name:'Synthetic Driver'},position:null,context:null,routing:{stops:[],geometry:null,distance_km:null,duration_hours:null,provider:'None',jurisdictions:['TEST'],regulatory_clearance:'NOT_EVALUATED'}}
const doc={id:1,evidence_key:'synthetic-licence',revision:1,kind:'SYNTHETIC_LICENCE',issuer:'Test issuer',document_ref:'test://licence',document_sha256:'a'.repeat(64),issued_at:'2026-01-01T00:00:00Z',expires_at:'2026-02-01T00:00:00Z',creator:90,review_status:'REVIEWED',entity_type:'driver',entity_label:'Synthetic Driver',driver:2,vehicle:null,trip:null,load:null}
async function login(page:Page,role='ADMIN',options:{failBoard?:boolean}={}){
  const writes:{path:string;body:Record<string,unknown>}[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const user={id:91,username:'synthetic-user',role,base_role:role,organisation:{id:91,name:'Synthetic Transport',slug:'synthetic'},facilities:[{id:92,name:'Synthetic Yard',slug:'synthetic-yard'}]}
  const records=[doc]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method()
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    let response:unknown={}
    if(path.startsWith('/api/auth/'))response={token:'synthetic-only',user}
    else if(method==='POST'){
      const body=route.request().postDataJSON();writes.push({path,body})
      if(path==='/api/regulatory/evidence/') {records.unshift({...doc,...body,id:2,review_status:'UNVERIFIED',creator:91});response={record:records[0]}}
      else if(path==='/api/queue/')response={queueEntry:{id:10,reg_number:'SYNTH-RETRY',status:'QUEUED'}}
      else throw new Error(`Unexpected write ${path}`)
    }else if(path==='/api/regulatory/evidence-workspace/')response={records,total:records.length,limit:200,as_of:'2026-10-07T08:00:00Z',scope:'Tenant-wide master evidence; synthetic test only.',can_create:role==='ADMIN',choices_limit:200,choices:{vehicle:[{id:1,label:'SYNTH-123'}],driver:[{id:2,label:'Synthetic Driver'}],trip:[{id:3,label:'Trip 3'}],load:[{id:4,label:'Synthetic load'}]}}
    else if(path==='/api/deliveries/'){
      if(options.failBoard){await route.fulfill({status:503,json:{detail:'Synthetic delivery feed unavailable'}});return}
      response={records:[{trip,journey:{trip_id:3,visit_id:2,stage:'DELIVERY_REJECTED',next_action:{kind:'DELIVERY_REATTEMPT_PLANNED',label:'Plan agreed delivery reattempt',owner_roles:['OPERATIONS_SUPERVISOR'],href:null},delivery_stops:[{resolved:false}],returns:[{state:'RETURN_AUTHORISED'}],closure:{physical_delivery:'OPEN',commercial:'NOT_CONFIRMED'},integrations:{erp:'NOT_CONFIGURED',tracking:'NOT_CONFIGURED'}}}],total:1,page:1,page_size:20,as_of:'2026-10-07T08:00:00Z',scope:'Synthetic origin-site journeys',organisation:user.organisation,facility:user.facilities[0]}
    }else if(path==='/api/trips/3/journey/')response={journey:{id:1,trip_id:3,visit_id:2,stage:'DELIVERY_REJECTED',yard_status:'RELEASED',dock:null,events:[],integrations:{erp:'NOT_CONFIGURED',tracking:'NOT_CONFIGURED'},next_action:{kind:'DELIVERY_REATTEMPT_PLANNED',label:'Plan agreed delivery reattempt',owner_roles:['OPERATIONS_SUPERVISOR'],href:null}}}
    else if(path==='/api/vehicles/')response={vehicles:[{id:1,plate:'SYNTH-123'}]}
    else if(path.startsWith('/api/regulatory/'))response={records:[]}
    else response={queue:[],alerts:[],docks:[],movements:[]}
    await route.fulfill({json:response})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(role==='ADMIN'?/\/reports$/:/\/queue$/)
  return {writes,errors,options}
}
async function capture(page:Page,name:string){
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:'instant'})});await page.screenshot({path:`../docs/design/${name}-desktop.png`,fullPage:true})
  await page.setViewportSize({width:390,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../docs/design/${name}-mobile.png`,fullPage:true})
}
test('evidence register exposes expiry and authors a renewal for independent review',async({page})=>{
  const {writes,errors}=await login(page)
  await page.goto('/evidence');await expect(page.getByRole('heading',{name:'Document register'})).toBeVisible();await expect(page.getByRole('region',{name:'Document register'}).getByText('Expired',{exact:true})).toBeVisible()
  await capture(page,'evidence-workspace')
  await page.getByRole('button',{name:'Record renewal revision'}).click()
  await expect(page.getByLabel('Revision',{exact:true})).toHaveValue('2')
  await expect(page.getByLabel('Record belongs to')).toHaveValue('driver')
  await page.getByLabel('Retained document location').fill('test://renewed-licence')
  await page.getByLabel('Issued at (local time)').fill('2026-10-01T10:00')
  await page.getByLabel('Expires at (local time)').fill('2027-10-01T10:00')
  await page.getByLabel('Source document fingerprint').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic renewal document')})
  await page.getByRole('button',{name:'Record evidence revision',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Evidence revision recorded'})).toBeVisible()
  expect(writes).toHaveLength(1);expect(writes[0].body).toMatchObject({driver:2,revision:2,evidence_key:doc.evidence_key,document_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
  expect(writes[0].body).not.toHaveProperty('vehicle');expect(errors).toEqual([])
})
test('delivery board retries a failed feed and opens existing journey controls',async({page})=>{
  const {writes,errors,options}=await login(page,'OPERATIONS_SUPERVISOR',{failBoard:true})
  await page.goto('/deliveries');await expect(page.getByRole('alert').filter({hasText:'Synthetic delivery feed unavailable'})).toBeVisible()
  options.failBoard=false;await page.getByRole('button',{name:'Retry',exact:true}).click()
  await expect(page.getByText('Plan agreed delivery reattempt',{exact:true})).toBeVisible()
  await capture(page,'delivery-workspace')
  await page.getByRole('button',{name:'Open next action'}).click()
  await expect(page).toHaveURL(/trip=3/)
  const panel=page.getByRole('region',{name:'Connected journey'})
  await expect(panel.getByRole('button',{name:'Record delivery reattempt planned'})).toBeDisabled()
  await page.goto('/evidence');await expect(page.getByText('Read-only evidence access.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Record a document revision'})).toHaveCount(0)
  expect(writes).toEqual([]);expect(errors).toEqual([])
})
test('recovery filters ownership, retries the original arrival and exports retained history',async({page})=>{
  const {writes,errors}=await login(page,'OPERATIONS_SUPERVISOR')
  await page.goto('/recovery');await expect(page.getByText('No saved submissions for this account and yard on this device.')).toBeVisible()
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('OperationalLocalDB');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})
    const original={id:'retained-key',actionType:'queue.create',payload:{licensePlate:'SYNTH-RETRY',driverName:'Synthetic Driver',destination:'Synthetic destination'},actorId:'91',facilityId:'92',apiBase:'http://127.0.0.1:8000',timestamp:1000,retryCount:5,state:'BLOCKED',retryable:true,lastError:'Synthetic network unavailable'}
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('pendingActions','readwrite');const store=tx.objectStore('pendingActions');store.put(original);store.put({...original,id:'other-user',actorId:'999',payload:{licensePlate:'PRIVATE-USER'}});store.put({...original,id:'other-yard',facilityId:'999',payload:{licensePlate:'PRIVATE-YARD'}});store.put({...original,id:'permanent',retryable:false,payload:{licensePlate:'REJECTED'}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});db.close()
  })
  await page.goto('/recovery');await expect(page.getByRole('heading',{name:'SYNTH-RETRY'})).toBeVisible();await expect(page.getByText('PRIVATE-USER')).toHaveCount(0);await expect(page.getByText('PRIVATE-YARD')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Retry original submission'})).toBeDisabled();await capture(page,'offline-recovery')
  await page.getByLabel('Retry reason').fill('Network restored; checked existing movements')
  await page.getByRole('button',{name:'Retry original submission'}).click()
  await expect(page.getByRole('status').filter({hasText:'Replay completed 1'})).toBeVisible()
  expect(writes).toHaveLength(1);expect(writes[0].body).toMatchObject({reg_number:'SYNTH-RETRY',idempotency_key:'q-retained-key'})
  await page.getByText('Recovery history on this device (1)',{exact:true}).click();await expect(page.getByText(/ · Network restored; checked existing movements/)).toBeVisible()
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export recovery record'}).click();expect((await download).suggestedFilename()).toBe('trucki-local-recovery.json')
  expect(errors).toEqual([])
})
