import {test,expect} from '@playwright/test'

test.use({trace:'off'})
test('production evidence, deliveries and device recovery load without operational writes',async({page,request})=>{
  test.skip(!process.env.BAK_ADMIN_PIN,'Explicit admin credentials required')
  const writes:string[]=[];const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET'&&!new URL(r.url()).pathname.startsWith('/api/auth/'))writes.push(r.url())})
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill(process.env.BAK_ADMIN_STAFF_ID||'TRK-BAK-ADMIN');await page.getByLabel('PIN',{exact:true}).fill(process.env.BAK_ADMIN_PIN!)
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/reports$/)
  const token=await page.evaluate(()=>localStorage.getItem('trucki-auth-token'));const headers={Authorization:`Token ${token}`};const api=process.env.PW_PROD_API_URL!
  const identity=await(await request.get(`${api}/api/auth/me/`,{headers})).json();const facility=identity.user.facilities[0].id
  const evidenceResponse=await request.get(`${api}/api/regulatory/evidence-workspace/`,{headers});expect(evidenceResponse.ok()).toBe(true)
  const evidence=await evidenceResponse.json();expect(evidence.can_create).toBe(true);expect(Array.isArray(evidence.records)).toBe(true)
  const deliveryResponse=await request.get(`${api}/api/deliveries/?facility=${facility}`,{headers});expect(deliveryResponse.ok()).toBe(true)
  const board=await deliveryResponse.json();expect(board.facility.id).toBe(facility);expect(board.organisation.id).toBe(identity.user.organisation.id)
  for(const row of board.records){expect(row.trip.synthetic).toBe(false);expect(row.journey.integrations).toEqual({erp:'NOT_CONFIGURED',tracking:'NOT_CONFIGURED'})}
  await page.goto('/evidence');await expect(page.getByRole('heading',{name:'Document register'})).toBeVisible()
  await page.getByRole('button',{name:'Record a document revision'}).click();await expect(page.getByRole('button',{name:'Record evidence revision',exact:true})).toBeDisabled()
  for(const type of ['vehicle','driver','trip','load']){await page.getByLabel('Record belongs to').selectOption(type);await expect(page.getByLabel(`Existing ${type}`,{exact:true})).toBeVisible()}
  await page.getByRole('button',{name:'Close document form'}).click()
  await page.setViewportSize({width:390,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'../docs/design/evidence-production-mobile.png',fullPage:true})
  await page.goto('/deliveries');await expect(page.getByRole('heading',{name:'Movement board'})).toBeVisible()
  if(board.total===0)await expect(page.getByText(/No linked journeys found/)).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'../docs/design/deliveries-production-mobile.png',fullPage:true})
  await page.goto('/recovery');await expect(page.getByRole('heading',{name:'Saved submissions'})).toBeVisible();await expect(page.getByText('No saved submissions for this account and yard on this device.')).toBeVisible()
  await page.getByLabel('Switch working role').selectOption('OPERATIONS_SUPERVISOR');await expect(page).toHaveURL(/\/queue$/)
  await page.goto('/evidence');await expect(page.getByText(/Read-only evidence access/)).toBeVisible();await expect(page.getByRole('button',{name:'Record a document revision'})).toHaveCount(0)
  await page.getByLabel('Switch working role').selectOption('ADMIN');await expect(page).toHaveURL(/\/reports$/)
  expect(writes).toEqual([]);expect(errors).toEqual([])
  console.log('Production workspace reads:',JSON.stringify({evidence:evidence.total,linked_journeys:board.total,facility_id:facility}))
  await page.getByText('Account',{exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click()
})
