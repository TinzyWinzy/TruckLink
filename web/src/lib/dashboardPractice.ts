import type { Dashboard, DashboardWindow } from './dashboard'

/** Invented examples confined to explicit practice mode, never used as a live fallback. */
export function practiceDashboard(window: DashboardWindow): Dashboard {
  const now = new Date(), hourly = window==='24h', days = window==='30d'?30:window==='7d'?7:1
  const step = hourly?3600000:86400000, count = hourly?25:days+1
  const start = new Date(now.getTime()-days*86400000)
  const series = Array.from({length:count}, (_,i)=>({at:new Date(start.getTime()+i*step).toISOString(),arrivals:[3,5,2,6,4,1,0,4][i%8],exits:[1,3,2,4,3,0,0,2][i%8]}))
  return { metric_version:'yard-dashboard-1',as_of:now.toISOString(),refresh_seconds:5,facility:{id:0,name:'Training yard',timezone:'Africa/Johannesburg'},window:{key:window,from:start.toISOString(),to:now.toISOString(),bucket:hourly?'hour':'day',partial_edge_buckets:true},series,
    summary:{active:8,blocked:2,arrivals:series.reduce((n,p)=>n+p.arrivals,0),physical_exits:series.reduce((n,p)=>n+p.exits,0),mean_turnaround_minutes:85},
    active_statuses:{QUEUED:3,ASSIGNED:1,AT_DOCK:1,QUARANTINED:1,PENDING_OVERRIDE:1,RELEASED:1},age_buckets:[{label:'Under 30m',count:2},{label:'30 to 60m',count:1},{label:'60 to 120m',count:3},{label:'120m+',count:2}],
    docks:{OCCUPIED:2,AVAILABLE:2,MAINTENANCE:1},alerts:{CRITICAL:1,HIGH:1,MEDIUM:0,LOW:0},coverage:{legacy_completions_excluded:0,invalid_exit_timestamps:0,future_arrivals_excluded:0,latest_yard_record_update:null,active_scope:'Invented active visits.',exit_scope:'Invented physical exits.',source:'Synthetic practice data. Not measured performance.',tracker:'NOT_CONFIGURED',erp:'NOT_CONFIGURED'} }
}
