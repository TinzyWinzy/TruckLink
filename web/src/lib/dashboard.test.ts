import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardCsv, dashboardSchema, fetchDashboard } from './dashboard'
import { practiceDashboard } from './dashboardPractice'
import { apiFetch } from './api'

vi.mock('./api',()=>({apiFetch:vi.fn()}))
beforeEach(()=>vi.clearAllMocks())

describe('dashboard data boundary',()=>{
  it('rejects invalid dates, negative counts and malformed timezones before chart rendering',()=>{
    const value=practiceDashboard('24h')
    expect(dashboardSchema.safeParse(value).success).toBe(true)
    expect(dashboardSchema.safeParse({...value,as_of:'invalid'}).success).toBe(false)
    expect(dashboardSchema.safeParse({...value,summary:{...value.summary,active:-1}}).success).toBe(false)
    expect(dashboardSchema.safeParse({...value,facility:{...value.facility,timezone:'not/a-zone'}}).success).toBe(false)
  })
  it('rejects a response from another site or chart window',async()=>{
    const controller=new AbortController(), value=practiceDashboard('7d')
    vi.mocked(apiFetch).mockResolvedValue({...value,facility:{...value.facility,id:92}})
    await expect(fetchDashboard('93','7d',controller.signal)).rejects.toThrow('scope changed')
    await expect(fetchDashboard('92','24h',controller.signal)).rejects.toThrow('scope changed')
  })
  it('preserves unknown turnaround rather than converting it to measured zero',()=>{
    const value=practiceDashboard('24h');value.summary.mean_turnaround_minutes=null
    expect(dashboardSchema.parse(value).summary.mean_turnaround_minutes).toBeNull()
  })
  it('exports recorded aggregate counts with scope and metric provenance',()=>{
    const value=practiceDashboard('24h'), csv=dashboardCsv(value)
    expect(csv).toContain('Recorded arrivals');expect(csv).toContain('Physical exits')
    expect(csv).toContain(value.facility.timezone);expect(csv).toContain(value.metric_version)
    expect(csv.split('\r\n')).toHaveLength(value.series.length+1)
  })
})
