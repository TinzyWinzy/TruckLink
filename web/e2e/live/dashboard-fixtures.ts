import { practiceDashboard } from '../../src/lib/dashboardPractice'
import type { DashboardWindow } from '../../src/lib/dashboard'

export function dashboardFixture(window: DashboardWindow = '24h', empty = false) {
  const data = practiceDashboard(window)
  data.facility = { id: 92, name:'Synthetic Yard', timezone:'Africa/Johannesburg' }
  data.coverage.source = 'Synthetic interface fixture, not measured performance.'
  if (empty) {
    data.summary = { active:0, blocked:0, arrivals:0, physical_exits:0, mean_turnaround_minutes:null }
    data.series = data.series.map(p=>({...p,arrivals:0,exits:0}))
    data.active_statuses = {}; data.age_buckets = data.age_buckets.map(b=>({...b,count:0})); data.docks={}; data.alerts={}
  }
  return data
}
