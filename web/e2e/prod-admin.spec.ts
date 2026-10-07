import { test, expect } from '@playwright/test'

test.use({ trace: 'off' })
test('production operations can inspect entry setup without changing evidence',async({page,request})=>{
  test.skip(!process.env.BAK_ADMIN_PIN,'Explicit admin credentials required')
  await page.goto('/')
  await page.getByLabel('Staff ID',{exact:true}).fill(process.env.BAK_ADMIN_STAFF_ID||'TRK-BAK-ADMIN')
  await page.getByLabel('PIN',{exact:true}).fill(process.env.BAK_ADMIN_PIN!)
  await page.getByRole('button',{name:'Sign in to shift',exact:true}).click()
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByLabel('Switch working role').selectOption('OPERATIONS_SUPERVISOR')
  await expect(page).toHaveURL(/\/queue$/)
  await expect(page.getByText(/^Tenant: /)).toBeVisible()
  await page.goto('/docks')
  await expect(page.getByRole('heading',{name:'Dock board'})).toBeVisible()
  await expect(page.getByText('72,000 m² · tap a free dock')).toHaveCount(0)
  await page.goto('/guide')
  await expect(page.getByRole('heading',{name:'Operational walkthrough'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Current site readiness'})).toBeVisible()
  await expect(page.getByLabel('Inspect an existing visit')).toBeVisible()
  await expect(page.getByText(/ERP: NOT CONFIGURED/)).toBeVisible()
  const token=await page.evaluate(()=>localStorage.getItem('trucki-auth-token'))
  const headers={Authorization:`Token ${token}`}
  const api=process.env.PW_PROD_API_URL!
  const response=await request.get(`${api}/api/regulatory/queue/1/setup/`,{headers})
  expect(response.ok()).toBe(true)
  const setup=await response.json()
  expect(setup.entry.id).toBe(1)
  expect(setup.can_record_context).toBe(true)
  console.log('Entry 1 setup:',JSON.stringify({trip_choices:setup.trips.length,usable_configurations:setup.configurations.filter((c:{usable:boolean})=>c.usable).length,load_choices:setup.loads.length,blockers:setup.blockers.map((b:{code:string})=>b.code)}))
  await page.goto('/compliance?entry=1')
  await expect(page.getByRole('heading',{name:'Operational gate inspection'})).toBeVisible()
  const context=await (await request.get(`${api}/api/regulatory/queue/1/context/`,{headers})).json()
  await expect(page.getByRole('heading',{name:setup.entry.registration,exact:true})).toBeVisible()
  await page.setViewportSize({width:1440,height:1000})
  await page.screenshot({path:'../docs/design/inspection-production-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:1000})
  await page.screenshot({path:'../docs/design/inspection-production-mobile.png',fullPage:true})
  if(!context.context){
    await page.getByRole('button',{name:'Complete operational setup'}).click()
    await expect(page.getByRole('heading',{name:'Prepare this inspection'})).toBeVisible()
    await expect(page.getByRole('button',{name:'Record versioned inspection'})).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Save operational setup'})).toBeDisabled()
  }
  await page.setViewportSize({width:390,height:1000})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByLabel('Switch working role').selectOption('ADMIN')
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByRole('link',{name:'Admin',exact:true}).click()
  await page.getByText('Create a staff account',{exact:true}).click()
  await expect(page.getByRole('button',{name:'Create staff access'})).toBeDisabled()
  await page.getByText('Register a vehicle',{exact:true}).click()
  await expect(page.getByLabel('Vehicle registration',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Save fleet vehicle'})).toBeDisabled()
  await page.getByRole('button',{name:'Open evidence register'}).click()
  await expect(page.getByText('Evidence register loaded.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await page.getByText('Account',{exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click()
})

test('production connected journey schema is readable without operational writes', async ({ request }) => {
  test.skip(!process.env.BAK_ADMIN_PIN, 'Explicit admin credentials required')
  const api=process.env.PW_PROD_API_URL!
  const login=await request.post(`${api}/api/auth/pin/`,{data:{staff_id:process.env.BAK_ADMIN_STAFF_ID || 'TRK-BAK-ADMIN',pin:process.env.BAK_ADMIN_PIN}})
  expect(login.ok()).toBe(true)
  const credentials=await login.json()
  const headers={Authorization:`Token ${credentials.token}`}
  try {
    const workspace=await request.get(`${api}/api/routes/workspace/?facility=${credentials.user.facilities[0].id}`,{headers})
    expect(workspace.ok()).toBe(true)
    const data=await workspace.json()
    expect(Array.isArray(data.visits)).toBe(true)
    expect(data.organisation.id).toBe(credentials.user.organisation.id)
    const board=await request.get(`${api}/api/yard/board/?facility=${credentials.user.facilities[0].id}`,{headers})
    expect(board.ok()).toBe(true)
    for(const visit of (await board.json()).queue){
      expect(['LEGACY_COMBINED','SEPARATE_V1']).toContain(visit.milestone_semantics)
      expect(visit).toHaveProperty('release_authorized_at')
      expect(visit).toHaveProperty('dock_vacated_at')
      expect(visit).toHaveProperty('journey_trip_id')
    }
    // A non-existent identity exercises the migrated journey table without creating records.
    const missing=await request.get(`${api}/api/trips/2147483647/journey/`,{headers})
    expect(missing.status()).toBe(404)
    expect((await missing.json()).detail).toBe('No linked origin visit')
    for(const trip of data.trips){
      const response=await request.get(`${api}/api/trips/${trip.id}/journey/`,{headers})
      expect([200,404]).toContain(response.status())
      if(response.ok()) {
        const journey=(await response.json()).journey
        expect(journey.trip_id).toBe(trip.id)
        expect(journey.next_action.owner_roles.length).toBeGreaterThan(0)
        expect(journey.closure.commercial).toBe('NOT_CONFIRMED')
      }
    }
  } finally { await request.post(`${api}/api/auth/logout/`,{headers}) }
})

test('production renewal API accepts fresh credentials despite stale access and revokes on logout', async ({ request }) => {
  test.skip(!process.env.BAK_ADMIN_PIN, 'Explicit admin credentials required')
  const api = process.env.PW_PROD_API_URL!
  const login = await request.post(`${api}/api/auth/pin/`, {
    headers: { Authorization: 'Token deliberately-obsolete-access' },
    data: { staff_id: process.env.BAK_ADMIN_STAFF_ID || 'TRK-BAK-ADMIN', pin: process.env.BAK_ADMIN_PIN },
  })
  expect(login.ok()).toBe(true)
  const credentials = await login.json()
  expect(credentials.refresh_token).toBeTruthy()
  expect(credentials.expires_in).toBe(1800)
  const refresh = await request.post(`${api}/api/auth/refresh/`, {
    headers: { Authorization: 'Token deliberately-obsolete-access' },
    data: { refresh_token: credentials.refresh_token },
  })
  expect(refresh.ok()).toBe(true)
  const renewed = await refresh.json()
  expect(renewed.token).not.toBe(credentials.token)
  expect(renewed.user.id).toBe(credentials.user.id)
  expect(renewed.user.organisation.id).toBe(credentials.user.organisation.id)
  expect((await request.get(`${api}/api/auth/me/`, { headers: { Authorization: `Token ${credentials.token}` } })).status()).toBe(401)
  const headers = { Authorization: `Token ${renewed.token}` }
  expect((await request.get(`${api}/api/auth/me/`, { headers })).ok()).toBe(true)
  expect((await request.post(`${api}/api/auth/logout/`, { headers })).ok()).toBe(true)
  expect((await request.post(`${api}/api/auth/refresh/`, { data: { refresh_token: credentials.refresh_token } })).status()).toBe(401)
})

test('live ADMIN PIN can switch working roles and return without changing identity', async ({ page, request }) => {
  test.skip(!process.env.BAK_ADMIN_PIN, 'Explicit admin credentials required')
  await page.goto('/')
  await page.getByLabel('Staff ID', { exact: true }).fill(process.env.BAK_ADMIN_STAFF_ID || 'TRK-BAK-ADMIN')
  await page.getByLabel('PIN', { exact: true }).fill(process.env.BAK_ADMIN_PIN!)
  await page.getByRole('button', { name: 'Sign in to shift', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByText(/Last successful read/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Review priority' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Data availability' })).toContainText(/movements? loaded/)
  const api = process.env.PW_PROD_API_URL!
  const token = await page.evaluate(() => localStorage.getItem('trucki-auth-token'))
  const headers = { Authorization: `Token ${token}` }
  const original = (await (await request.get(`${api}/api/auth/me/`, { headers })).json()).user
  expect(original.role).toBe('ADMIN')
  await page.getByLabel('Switch working role').selectOption('DISPATCH_SUPERVISOR')
  await expect(page.getByRole('heading', { name: 'Shift queue' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  const switched = (await (await request.get(`${api}/api/auth/me/`, { headers })).json()).user
  expect(switched.id).toBe(original.id)
  expect(switched.role).toBe('DISPATCH_SUPERVISOR')
  expect(switched.base_role).toBe('ADMIN')
  const queue = await request.get(`${api}/api/queue/?facility=${original.facilities[0].id}`, { headers })
  expect(queue.ok()).toBe(true)
  // Expire the browser's access token through a real server-side renewal.
  // On returning, the app must renew its saved session and retain the working role.
  const refreshToken = await page.evaluate(() => localStorage.getItem('trucki-refresh-token'))
  expect(refreshToken).toBeTruthy()
  await page.goto('about:blank')
  const renewed = await request.post(`${api}/api/auth/refresh/`, { data: { refresh_token: refreshToken } })
  expect(renewed.ok()).toBe(true)
  await page.goto('/queue')
  await expect(page.getByLabel('Switch working role')).toHaveValue('DISPATCH_SUPERVISOR')
  expect(await page.evaluate(() => localStorage.getItem('trucki-auth-token'))).not.toBe(token)
  await page.getByLabel('Switch working role').selectOption('ADMIN')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByLabel('Switch working role')).toHaveValue('ADMIN')
  await expect(page.getByText(/Last successful read/)).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Data availability'})).not.toContainText('Awaiting first read')
  await page.setViewportSize({width:1440,height:1000})
  await page.screenshot({ path: '../docs/design/reports-production-desktop.png', fullPage: true })
  await page.setViewportSize({width:390,height:1000})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({ path: '../docs/design/reports-production-mobile.png', fullPage: true })
  await page.getByText('Account',{exact:true}).click();await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Gate sign-in' })).toBeVisible()
})


test('production guided workspace, compliance review and filtered CSV remain read-only',async({page})=>{
  test.skip(!process.env.BAK_ADMIN_PIN,'Explicit admin credentials required')
  const writes:string[]=[];page.on('request',req=>{const url=new URL(req.url());if(url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(req.method())&&!url.pathname.startsWith('/api/auth/'))writes.push(url.pathname)})
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill(process.env.BAK_ADMIN_STAFF_ID||'TRK-BAK-ADMIN');await page.getByLabel('PIN',{exact:true}).fill(process.env.BAK_ADMIN_PIN!);await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('region',{name:'Role worklist'})).toBeVisible()
  await page.getByLabel('Switch working role').selectOption('COMPLIANCE_OFFICER');await expect(page).toHaveURL(/\/approvals$/);await expect(page.getByRole('heading',{name:/Evidence and configuration reviews/})).toBeVisible()
  await page.goto('/compliance?entry=1');await expect(page.getByText(/Read-only inspection access/)).toBeVisible();await expect(page.getByRole('button',{name:'Save operational setup'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Record versioned inspection'})).toHaveCount(0)
  await page.goto('/dispatch?entry=1');await expect(page.getByRole('heading',{name:'Guided dispatch'})).toBeVisible();await expect(page.getByText(/Assigned person: unassigned/)).toBeVisible()
  await page.goto('/audit');await expect(page.getByText(/Display timezone:/)).toBeVisible();await page.getByLabel('Exact action code, optional').fill('CREATE_QUEUE_ENTRY');await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByText(/Display timezone:/)).toBeVisible()
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download filtered CSV'}).click();const download=await downloading;expect(download.suggestedFilename()).toBe('trucki-audit.csv');expect(await download.failure()).toBeNull()
  await page.getByLabel('Switch working role').selectOption('EXECUTIVE');await expect(page).toHaveURL(/\/reports$/);await page.goto('/routes');await expect(page.getByText(/Dispatch saves assigned trips; your role has no draft-save permission/)).toBeVisible();await expect(page.getByRole('button',{name:'Save draft trip'})).toHaveCount(0)
  await page.getByLabel('Switch working role').selectOption('ADMIN');await expect(page).toHaveURL(/\/reports$/);await page.goto('/admin');await expect(page.getByRole('heading',{name:'Site docks',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add site dock'})).toBeDisabled()
  await page.goto('/dispatch?entry=1');await page.getByText('Assign the next handoff owner',{exact:true}).click();await expect(page.getByRole('combobox',{name:'Responsible staff member'})).toBeVisible();await expect(page.getByRole('button',{name:'Assign accountable owner'})).toBeDisabled()
  expect(writes).toEqual([]);await page.getByText('Account',{exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click()
})
