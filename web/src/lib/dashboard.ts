import { z } from 'zod'
import { apiFetch } from './api'

const count = z.number().int().nonnegative()
const counts = z.record(z.string(), count)
const timestamp = z.string().datetime({ offset: true })
export const dashboardSchema = z.object({
  metric_version: z.literal('yard-dashboard-1'), as_of: timestamp, refresh_seconds: z.number().positive(),
  facility: z.object({ id: z.number().int(), name: z.string(), timezone: z.string().refine(value=>{try { new Intl.DateTimeFormat(undefined,{timeZone:value}); return true } catch { return false }}) }),
  window: z.object({ key: z.enum(['24h', '7d', '30d']), from: timestamp, to: timestamp, bucket: z.enum(['hour', 'day']), partial_edge_buckets: z.boolean() }),
  series: z.array(z.object({ at: timestamp, arrivals: count, exits: count })).min(1).max(32),
  active_statuses: counts, age_buckets: z.array(z.object({ label: z.string(), count })),
  summary: z.object({ active: count, blocked: count, arrivals: count, physical_exits: count, mean_turnaround_minutes: z.number().nonnegative().nullable() }),
  docks: counts.nullable(), alerts: counts.nullable(),
  coverage: z.object({ legacy_completions_excluded: count, invalid_exit_timestamps: count, future_arrivals_excluded: count,
    latest_yard_record_update: timestamp.nullable(), active_scope: z.string(), exit_scope: z.string(), source: z.string(), tracker: z.string(), erp: z.string() }),
})
export type Dashboard = z.infer<typeof dashboardSchema>
export type DashboardWindow = Dashboard['window']['key']

export async function fetchDashboard(facility: string, window: DashboardWindow, signal: AbortSignal): Promise<Dashboard> {
  const raw = await apiFetch(`/reports/dashboard/?facility=${encodeURIComponent(facility)}&window=${window}`, { signal })
  const result = dashboardSchema.safeParse(raw)
  if (!result.success) throw new Error('Dashboard response is incomplete. Retry or contact your administrator.')
  if (String(result.data.facility.id) !== facility || result.data.window.key !== window) throw new Error('Dashboard scope changed. Refresh this workspace.')
  return result.data
}

export function dashboardCsv(data: Dashboard): string {
  const rows = [['Bucket start (ISO)', 'Recorded arrivals', 'Physical exits', 'Site timezone', 'Snapshot as of', 'Metric version'],
    ...data.series.map(p => [p.at, String(p.arrivals), String(p.exits), data.facility.timezone, data.as_of, data.metric_version])]
  return rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
}
