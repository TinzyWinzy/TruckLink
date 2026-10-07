import { test, expect, type Page } from '@playwright/test'

const trip={id:3,origin:'Synthetic loading yard',destination:'Synthetic receiver',status:'inquiry',synthetic:false,vehicle:{id:1,plate:'SYNTH-123'},driver:{id:2,name:'Synthetic Driver'},position:null,context:null,routing:{stops:[],geometry:null,distance_km:null,duration_hours:null,provider:'None',jurisdictions:['TEST'],regulatory_clearance:'NOT_EVALUATED'}}
const journey={id:1,trip_id:3,visit_id:2,stage:'AT_ORIGIN',yard_status:'AT_DOCK',dock:null,events:[],integrations:{erp:'NOT_CONFIGURED',tracking:'NOT_CONFIGURED'},next_action:{kind:null,label:'Complete inspection and release approval',owner_roles:['DISPATCH_SUPERVISOR'],href:'/compliance?entry=2',scope:null},delivery_plan:{id:8,version:1,stops:[{route_index:0,consignments:[{reference:'SYN-LOAD-1',quantity:'12.500',unit:'t'}]}]},delivery_stops:[{index:0,label:'Synthetic receiver',consignments:[],state:'PENDING',return_order_id:null,resolved:false}],returns:[]}
const order={id:7,reference:'SYN-CONSIGNMENT-1',customer_name:'Synthetic distribution customer',customer_reference:'SYN-PO-17',commodity:'Synthetic goods',target_quantity:'25.000',unit:'t',deadline:'2020-01-01',created_at:'2026-10-07T08:00:00Z',creator_id:91,reason:'Synthetic customer order',external_reference:{system:'Test ERP',reference:'SYN-ERP-17',verification:'MANUALLY_RECORDED'},progress:{allocated:'0.000',accepted:'0.000',returned:'0.000',unallocated:'25.000',outstanding:'25.000',percentage:0,complete:false,overdue:true},allocations:[] as unknown[],integration_status:'NOT_CONFIGURED',commercial_closure:'NOT_CONFIRMED'}

async function setup(page:Page,{role='ADMIN',empty=false,failFirst=false,partial=false}={}){
  const current=structuredClone(order),writes:{path:string;body:Record<string,unknown>}[]=[],errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  let records=empty?[]:[current],failing=failFirst
  const allocation={id:1,reference:'SYN-LOAD-1',quantity:'12.500',unit:'t',plan_id:8,plan_version:1,stop_index:0,stop_label:'Synthetic receiver',delivery_state:'PENDING',return_order_id:null,trip,journey,created_at:'2026-10-07T08:00:00Z',creator_id:91,reason:'Synthetic allocation'}
  if(partial){current.allocations=[{...allocation,delivery_state:'DELIVERY_ACCEPTED',journey:{...journey,stage:'DELIVERY_ACCEPTED',next_action:{...journey.next_action,label:'Reconcile delivery evidence'}}}];current.progress={...current.progress,allocated:'12.500',accepted:'12.500',unallocated:'12.500',outstanding:'12.500',percentage:50}}
  const user={id:91,username:'synthetic-user',role,base_role:role,organisation:{id:91,name:'Synthetic Transport',slug:'synthetic'},facilities:[{id:92,name:'Synthetic Yard',slug:'synthetic-yard'}]}
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname,method=route.request().method()
    if(path==='/api/auth/me/'&&!route.request().headers().authorization){await route.fulfill({status:401,json:{}});return}
    let response:unknown={}
    if(path.startsWith('/api/auth/'))response={token:'synthetic-only',user}
    else if(method==='POST'){
      const body=route.request().postDataJSON();writes.push({path,body})
      if(path==='/api/consignments/'){Object.assign(current,body);records=[current];response={consignment:current}}
      else if(path==='/api/consignments/7/'){current.allocations=[allocation];current.progress={...current.progress,allocated:'12.500',unallocated:'12.500'};response={consignment:current}}
      else throw new Error(`Unexpected write ${path}`)
    }else if(path==='/api/consignments/'){
      if(failing){await route.fulfill({status:503,json:{detail:'Synthetic order feed unavailable'}});return}
      response={records,total:records.length,page:1,page_size:20,as_of:'2026-10-07T08:00:00Z',can_create:role==='ADMIN',facility:user.facilities[0],organisation:user.organisation}
    }else if(path==='/api/consignments/7/')response={consignment:current}
    else if(path==='/api/deliveries/')response={records:[{trip,journey}],total:1,page:1,page_size:20,facility:user.facilities[0],organisation:user.organisation}
    else if(path==='/api/trips/3/journey/')response={journey}
    else if(path.startsWith('/api/regulatory/'))response={records:[]}
    else response={queue:[],alerts:[],docks:[],movements:[]}
    await route.fulfill({json:response})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/reports$/)
  return {writes,errors,current,allowReads:()=>{failing=false}}
}

test('dispatcher records a customer order and allocates a retained load without granting release',async({page})=>{
  const {writes,errors}=await setup(page,{empty:true})
  await page.goto('/consignments');await page.getByRole('button',{name:'New consignment',exact:true}).click()
  for(const [label,value] of [['Consignment reference','SYN-CONSIGNMENT-1'],['Customer name','Synthetic distribution customer'],['Customer order reference (optional)','SYN-PO-17'],['Commodity / goods','Synthetic goods'],['Target quantity','25'],['Quantity unit','t'],['Reason for recording','Synthetic customer order']])await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByRole('button',{name:'Save consignment',exact:true}).click()
  await expect(page).toHaveURL(/order=7/)
  await page.getByRole('combobox',{name:'Truck movement',exact:true}).selectOption('3')
  await expect(page.getByRole('combobox',{name:'Delivery-plan line',exact:true})).toBeEnabled()
  await page.getByRole('combobox',{name:'Delivery-plan line',exact:true}).selectOption('0:SYN-LOAD-1')
  await page.getByLabel('Allocation reason',{exact:true}).fill('Synthetic dispatch allocation')
  await page.getByRole('button',{name:'Allocate load to consignment',exact:true}).click()
  await expect(page.getByRole('heading',{name:'SYNTH-123 · 12.5 t',exact:true})).toBeVisible()
  await expect(page.getByText('Complete inspection and release approval',{exact:true})).toBeVisible()
  expect(writes.map(w=>w.path)).toEqual(['/api/consignments/','/api/consignments/7/'])
  expect(writes[1].body).toMatchObject({plan_id:8,stop_index:0,reference:'SYN-LOAD-1',reason:'Synthetic dispatch allocation'})
  expect(writes[1].body).not.toHaveProperty('quantity')
  expect(errors).toEqual([])
})

test('customer dossier shows partial fulfilment and a connected movement on desktop and mobile',async({page})=>{
  const {writes,errors}=await setup(page,{partial:true})
  await page.goto('/consignments?order=7')
  await expect(page.getByRole('heading',{name:'Loads and next actions'})).toBeVisible()
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow','50')
  await expect(page.getByText('Overdue',{exact:true})).toBeVisible()
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'../docs/design/consignments-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../docs/design/consignments-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Open movement',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Registration to destination'})).toBeVisible()
  expect(writes).toEqual([]);expect(errors).toEqual([])
})

test('executive can follow the dossier without order or allocation authoring controls',async({page})=>{
  const {writes,errors}=await setup(page,{role:'EXECUTIVE',partial:true})
  await page.goto('/consignments?order=7')
  await expect(page.getByRole('heading',{name:'Loads and next actions'})).toBeVisible()
  await expect(page.getByRole('button',{name:'New consignment',exact:true})).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Allocate a planned load'})).toHaveCount(0)
  await page.getByRole('button',{name:'Open movement',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Registration to destination'})).toBeVisible()
  expect(writes).toEqual([]);expect(errors).toEqual([])
})

test('failed reads report failure and retry instead of reporting an empty order register',async({page})=>{
  const {writes,errors,allowReads}=await setup(page,{failFirst:true})
  await page.goto('/consignments')
  await expect(page.getByRole('alert').filter({hasText:'Synthetic order feed unavailable'})).toBeVisible()
  await expect(page.getByText('No consignments found for this yard.')).toHaveCount(0)
  allowReads();await page.getByRole('button',{name:'Retry',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Consignment register'})).toBeVisible()
  expect(writes).toEqual([]);expect(errors).toEqual([])
})
