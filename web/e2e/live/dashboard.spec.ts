import { test, expect, type Page } from '@playwright/test'
import { dashboardFixture } from './dashboard-fixtures'
import type { DashboardWindow } from '../../src/lib/dashboard'

async function setup(page: Page, { fail = false, empty = false, hold = false } = {}) {
  const user={id:91,username:'synthetic-dashboard',role:'EXECUTIVE',base_role:'EXECUTIVE',organisation:{id:91,name:'Synthetic Transport',slug:'synthetic'},facilities:[{id:92,name:'Synthetic Yard',slug:'synthetic-yard'}]}
  const requests: string[] = [], errors: string[] = [], writes: string[] = []
  let failed=fail, blocked=hold, nextActive=8, unblock:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{unblock=resolve})
  page.on('pageerror', e=>errors.push(e.message))
  await page.route('**/api/**', async route=>{
    const request=route.request(), url=new URL(request.url()), path=url.pathname
    if(path==='/api/auth/me/'&&!request.headers().authorization){await route.fulfill({status:401,json:{}});return}
    if(path.startsWith('/api/auth/')){await route.fulfill({json:{token:'synthetic-only',user}});return}
    if(request.method()!=='GET')writes.push(path)
    if(path==='/api/reports/dashboard/'){
      requests.push(url.searchParams.get('window')??'')
      expect(url.searchParams.get('facility')).toBe('92')
      expect(request.headers().authorization).toBe('Token synthetic-only')
      if(blocked)await gate
      if(failed){await route.fulfill({status:503,json:{detail:'Synthetic dashboard outage'}});return}
      const data=dashboardFixture(url.searchParams.get('window') as DashboardWindow,empty)
      if(!empty){data.summary.active=nextActive;data.active_statuses.QUEUED+=nextActive-8}
      await route.fulfill({json:data});return
    }
    if(path==='/api/reports/export.csv'){await route.fulfill({contentType:'text/csv',body:'id,reg_number\r\n1,SYNTHETIC\r\n'});return}
    await route.fulfill({json:path==='/api/operations/'?{as_of:new Date().toISOString(),movements:[],docks:5,notice:'Synthetic'}:{queue:[],alerts:[],docks:[]}})
  })
  await page.goto('/');await page.getByLabel('Staff ID',{exact:true}).fill('SYNTHETIC');await page.getByLabel('PIN',{exact:true}).fill('112233');await page.getByRole('button',{name:'Sign in to shift',exact:true}).click();await expect(page).toHaveURL(/\/reports$/)
  return { requests, errors, writes, recover:()=>{failed=false}, fail:()=>{failed=true}, setActive:(n:number)=>{nextActive=n}, release:()=>{blocked=false;unblock()} }
}

test('dashboard waits for evidence then presents scoped graphs on desktop and mobile',async({page})=>{
  const state=await setup(page,{hold:true})
  await expect(page.getByText('Loading activity graphs and source coverage…')).toBeVisible()
  await expect(page.getByRole('region',{name:'Yard activity chart'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeDisabled()
  state.release()
  await expect(page.getByRole('region',{name:'Yard activity chart'})).toBeVisible()
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('8 active visits')
  await page.getByRole('combobox',{name:'Chart window'}).selectOption('7d')
  await expect.poll(()=>state.requests.at(-1)).toBe('7d')
  await expect(page.getByRole('region',{name:'Yard activity chart'})).toContainText('Daily counts')
  const point=page.getByRole('region',{name:'Yard activity chart'}).locator('svg g[tabindex]').first()
  await point.focus();await expect(point).toBeFocused()
  await page.getByText('View activity data',{exact:true}).click()
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByText('View activity data',{exact:true}).click()
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.setViewportSize({width:1440,height:1100})
  await page.screenshot({path:'../docs/design/live-dashboard-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'../docs/design/live-dashboard-mobile.png',fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([])
})

test('five second polling updates counts and pause retains the last snapshot',async({page})=>{
  const state=await setup(page)
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('8 active visits')
  state.setActive(9)
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('9 active visits',{timeout:10000})
  await page.getByRole('button',{name:'Pause updates',exact:true}).click()
  await expect(page.getByText('Updates paused.',{exact:false})).toBeVisible()
  const before=state.requests.length
  state.setActive(10)
  await page.waitForTimeout(5500)
  expect(state.requests).toHaveLength(before)
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('9 active visits')
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Resume updates',exact:true}).click()
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('10 active visits',{timeout:10000})
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([])
})

test('failed initial reads are not empty success and retry recovers',async({page})=>{
  const state=await setup(page,{fail:true})
  await expect(page.getByRole('alert').filter({hasText:'Synthetic dashboard outage'})).toBeVisible()
  await expect(page.getByText('No recorded arrivals or physical exits in this window.')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeDisabled()
  state.recover();await page.getByRole('button',{name:'Retry dashboard',exact:true}).click()
  await expect(page.getByRole('region',{name:'Yard activity chart'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled()
  expect(state.errors).toEqual([])
})

test('a later outage preserves graphs with an explicit stale warning',async({page})=>{
  const state=await setup(page)
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('8 active visits')
  state.fail()
  await expect(page.locator('.intel-stale-banner')).toContainText('Snapshot may be stale.',{timeout:10000})
  await expect(page.getByRole('region',{name:'Active movements'})).toContainText('8 active visits')
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeDisabled()
  expect(state.errors).toEqual([])
})

test('empty recorded data stays empty and both export paths download',async({page})=>{
  const state=await setup(page,{empty:true})
  await expect(page.getByText('No recorded arrivals or physical exits in this window.')).toBeVisible()
  await expect(page.getByText('No physical exits',{exact:true})).toBeVisible()
  await expect(page.getByText('No configured docks.',{exact:true})).toBeVisible()
  const visits=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();expect((await visits).suggestedFilename()).toMatch(/trk-turnaround.*csv/)
  await page.getByText('Definitions, exclusions and export',{exact:true}).click()
  const chart=page.waitForEvent('download');await page.getByRole('button',{name:'Export chart CSV',exact:true}).click();expect((await chart).suggestedFilename()).toBe('trucki-activity-24h.csv')
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([])
})
