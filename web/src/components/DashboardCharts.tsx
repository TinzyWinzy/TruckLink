import { useEffect, useRef, useState } from 'react'
import type { Dashboard } from '../lib/dashboard'

const colours = { arrivals: '#ac651c', exits: '#147565', ink: '#243b53', blocked: '#b53d36', warning: '#996018', muted: '#64748b' }
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, s => s.toUpperCase())

export function ActivityChart({ data }: { data: Dashboard }) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(680)
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, entries[0].contentRect.width)))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const height = 245, left = 34, right = 10, top = 20, bottom = 35
  const plotWidth = width - left - right, plotHeight = height - top - bottom
  const max = Math.max(1, ...data.series.flatMap(p => [p.arrivals, p.exits]))
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4)
  const slot = plotWidth / data.series.length
  const bar = Math.max(1, Math.min(12, slot * .32))
  const tickCount = Math.min(data.series.length, width < 420 ? 4 : 6)
  const ticks = new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(data.series.length-1)/Math.max(1,tickCount-1))))
  const format = (at: string, detailed = false) => new Intl.DateTimeFormat(undefined, {
    timeZone: data.facility.timezone,
    ...(data.window.bucket === 'hour' ? { hour: '2-digit', minute: '2-digit', ...(detailed ? { month: 'short', day: 'numeric', timeZoneName:'short' } as const : {}) } : { month: 'short', day: 'numeric' }),
  }).format(new Date(at))
  const point = selected == null ? null : data.series[selected]
  return <section className="report-panel intel-activity" aria-label="Yard activity chart">
    <div className="report-section-heading"><h2>Arrivals & physical exits</h2><span>{data.window.bucket === 'hour' ? 'Hourly' : 'Daily'} counts</span></div>
    <div className="intel-legend"><span><i style={{ background: colours.arrivals }} />Recorded arrivals</span><span><i style={{ background: colours.exits }} />Physical exits</span></div>
    <div ref={host} className="intel-chart-host">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Recorded arrivals and physical exits. Focus a time bucket for its counts.">
        {[0, 1, 2, 3, 4].map(i => { const value = ceiling * i / 4, y = top + plotHeight * (1 - i / 4); return <g key={i}><line x1={left} x2={width-right} y1={y} y2={y} stroke="#e2e7e9" /><text x={left-9} y={y+4} textAnchor="end" fill="#526171" fontSize="12">{value}</text></g> })}
        {data.series.map((p, i) => {
          const x = left + slot * (i + .5)
          const tick = ticks.has(i)
          return <g key={p.at} tabIndex={0} className="intel-chart-point" role="img" aria-label={`${format(p.at, true)}: ${p.arrivals} recorded arrivals, ${p.exits} physical exits`}
            onFocus={() => setSelected(i)} onBlur={() => setSelected(null)} onMouseEnter={() => setSelected(i)} onMouseLeave={() => setSelected(null)}>
            <rect x={x-slot/2} y={top} width={slot} height={plotHeight} fill={selected === i ? '#f2f0e9' : 'transparent'} />
            <rect x={x-bar-1} y={top+plotHeight*(1-p.arrivals/ceiling)} width={bar} height={plotHeight*p.arrivals/ceiling} rx="2" fill={colours.arrivals} />
            <rect x={x+1} y={top+plotHeight*(1-p.exits/ceiling)} width={bar} height={plotHeight*p.exits/ceiling} rx="2" fill={colours.exits} />
            {tick && <text x={x} y={height-10} textAnchor={i===0?'start':i===data.series.length-1?'end':'middle'} fill="#526171" fontSize="12">{format(p.at)}</text>}
          </g>
        })}
      </svg>
    </div>
    <p className="intel-chart-caption">{point ? `${format(point.at, true)} · ${point.arrivals} arrivals · ${point.exits} physical exits` : `Recorded events in ${data.facility.timezone}. First and last buckets may be partial.`}</p>
    {data.summary.arrivals === 0 && data.summary.physical_exits === 0 && <p className="intel-no-events">No recorded arrivals or physical exits in this window.</p>}
    <details className="operational-details mt-3"><summary>View activity data</summary><div className="intel-table-scroll"><table><caption className="sr-only">Activity counts by bucket start in site timezone</caption><thead><tr><th>Bucket start</th><th>Arrivals</th><th>Physical exits</th></tr></thead><tbody>{data.series.map(p => <tr key={p.at}><th scope="row">{format(p.at, true)}</th><td>{p.arrivals}</td><td>{p.exits}</td></tr>)}</tbody></table></div></details>
  </section>
}

export function CountChart({ title, subtitle, values, empty, colour }: {
  title: string; subtitle: string; values: { label: string; count: number; key?: string }[]; empty: string; colour?: (key: string, index: number) => string
}) {
  const max = Math.max(1, ...values.map(v => v.count))
  return <section className="report-panel intel-count-panel" aria-label={title}>
    <div className="report-section-heading"><h2>{title}</h2></div><p className="intel-panel-sub">{subtitle}</p>
    {!values.some(v => v.count) ? <p className="intel-no-events">{empty}</p> : <ul className="intel-counts">{values.map((v, i) => <li key={v.key ?? v.label}>
      <div><span>{v.label}</span><strong>{v.count}</strong></div><div className="intel-bar-track" aria-hidden="true"><i style={{ width: `${100*v.count/max}%`, background: colour?.(v.key ?? v.label, i) ?? colours.ink }} /></div>
    </li>)}</ul>}
  </section>
}

export function DashboardCharts({ data }: { data: Dashboard }) {
  const dockTotal = data.docks ? Object.values(data.docks).reduce((a,b)=>a+b,0) : null
  return <>
    <div className="intel-top-grid"><ActivityChart data={data} /><CountChart title="Time in yard" subtitle="All active visits, measured since recorded arrival" values={data.age_buckets} empty="No recorded active visits." colour={(_, i) => [colours.ink, colours.ink, colours.warning, colours.blocked][i]} /></div>
    <div className="intel-bottom-grid">
      <CountChart title="Active movements" subtitle={`${data.summary.active} active visits across all arrival dates`} values={Object.entries(data.active_statuses).map(([key,count])=>({key,label:label(key),count}))} empty="No recorded active visits." colour={key=>key==='QUARANTINED'?colours.blocked:key==='PENDING_OVERRIDE'?colours.warning:colours.ink} />
      <CountChart title="Dock occupancy" subtitle={dockTotal == null ? 'Dock data not permitted for this account' : `${dockTotal} configured docks · current snapshot`} values={['OCCUPIED','AVAILABLE','MAINTENANCE'].map(key=>({key,label:label(key),count:data.docks?.[key]??0}))} empty={dockTotal == null ? 'Dock data unavailable for this account.' : 'No configured docks.'} colour={key=>key==='AVAILABLE'?colours.exits:key==='MAINTENANCE'?colours.warning:colours.ink} />
      <CountChart title="Open alerts" subtitle="Unacknowledged alerts by severity" values={['CRITICAL','HIGH','MEDIUM','LOW'].map(key=>({key,label:label(key),count:data.alerts?.[key]??0}))} empty={data.alerts==null?'Alert data unavailable for this account.':'No unacknowledged alerts recorded.'} colour={key=>['CRITICAL','HIGH'].includes(key)?colours.blocked:key==='MEDIUM'?colours.warning:colours.muted} />
    </div>
  </>
}
