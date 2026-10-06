import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, facilityId } from '../lib/api'
import { useLive } from '../lib/liveGate'
import { useSession } from '../store/session'
import { canVisit } from '../lib/gates'
import { syntheticRoutes, type RouteTrip, type RouteWorkspace } from '../lib/routes'
import RouteMap from '../components/RouteMap'
import { PageHeader, Section } from '../components/ui'

export default function RoutesMap() {
  const live = useLive()
  const role = useSession(s => s.role)
  const [mode, setMode] = useState<'operational' | 'synthetic'>(live ? 'operational' : 'synthetic')
  const [workspace, setWorkspace] = useState<RouteWorkspace | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [previewTrip, setPreviewTrip] = useState<RouteTrip | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [input, setInput] = useState({ origin: 'Harare, Zimbabwe', destination: 'Beitbridge, Zimbabwe', waypoints: '', route_type: 'DOMESTIC', jurisdictions: 'ZW', vehicle_id: '', driver_id: '' })
  const replayKey = useRef(crypto.randomUUID())
  const [fixtures] = useState(syntheticRoutes)
  useEffect(() => {
    if (!live || mode !== 'operational') return
    let stopped = false; let inFlight = false
    async function load() {
      if (stopped || inFlight || document.hidden) return
      inFlight = true
      try { const result = await apiFetch<RouteWorkspace>(`/routes/workspace/?facility=${encodeURIComponent(facilityId)}`); if (!stopped) { setWorkspace(result); setFeedError(null) } }
      catch (e) { if (!stopped) setFeedError((e as Error).message) }
      finally { inFlight = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => { stopped = true; clearInterval(timer) }
  }, [live, mode, refresh])
  const trips = mode === 'synthetic' ? fixtures : workspace?.trips ?? []
  const selected = previewTrip ?? trips.find(t => t.id === selectedId) ?? null
  const mapTrips = previewTrip ? [previewTrip] : trips
  const chooseTrip = useCallback((id: number) => { if (id === -1) return; setPreviewTrip(null); setSelectedId(id); setNotice(null) }, [])
  function change(key: keyof typeof input, value: string) {
    setInput(old => ({ ...old, [key]: value })); setPreviewTrip(null); setNotice(null); replayKey.current = crypto.randomUUID()
  }
  function body() { return { ...input, facility: facilityId,
    waypoints: input.waypoints.split('\n').map(s => s.trim()).filter(Boolean),
    jurisdictions: input.jurisdictions.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    vehicle_id: input.vehicle_id ? Number(input.vehicle_id) : null, driver_id: input.driver_id ? Number(input.driver_id) : null } }
  async function preview() {
    setBusy(true); setError(null); setNotice(null); setPreviewTrip(null)
    try {
      const response = await apiFetch<{ routing: RouteTrip['routing'] }>('/routes/preview/', { method: 'POST', body: body() })
      setPreviewTrip({ id: -1, origin: input.origin, destination: input.destination, status: 'UNSAVED PREVIEW', synthetic: false, routing: response.routing, position: null, vehicle: null, driver: null, context: null })
      setSelectedId(null)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function save() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const response = await apiFetch<{ trip: RouteTrip; replayed: boolean }>('/routes/drafts/', { method: 'POST', body: { ...body(), client_key: replayKey.current } })
      setWorkspace(old => old ? { ...old, trips: [response.trip, ...old.trips.filter(t => t.id !== response.trip.id)] } : old)
      setPreviewTrip(null); setSelectedId(response.trip.id); setNotice(`Draft trip ${response.trip.id} saved. Inspection and release have not been authorized.`); setRefresh(n => n + 1)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    <PageHeader title="Routes & map" eyebrow="Route and fleet evidence" sub="Plan ordered stops, inspect reported positions and review the evidence attached to a trip." mode={live ? 'live' : 'demo'} />
    <div className="route-mode-bar"><div className="flex flex-wrap gap-2" role="group" aria-label="Map data source">
      <button className="route-mode-button" aria-pressed={mode === 'operational'} disabled={!live || busy} onClick={() => { setMode('operational'); setPreviewTrip(null); setSelectedId(null); setError(null) }}>Operational trips</button>
      <button className="route-mode-button" aria-pressed={mode === 'synthetic'} disabled={busy} onClick={() => { setMode('synthetic'); setPreviewTrip(null); setSelectedId(null); setError(null); setNotice(null) }}>Synthetic journeys</button>
    </div><p className="text-xs text-slate-600">{mode === 'synthetic' ? 'Invented scenario, as of 1 January 2026 at 11:00 UTC. No operational writes.' : `${workspace?.organisation.name ?? 'Tenant workspace'} / ${workspace?.facility.name ?? 'Assigned yard'}. Reported positions refresh every 30 seconds.`}</p></div>
    <p className="border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">{mode === 'synthetic' ? 'Synthetic vehicles and stops only. Dashed connections are illustrative, not calculated road routes.' : 'Road distance and drive time are estimates from a generic driving profile. Heavy-vehicle suitability, permits, border passage and regulatory clearance require independent evidence.'}</p>
    {mode === 'operational' && feedError && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Workspace data unavailable: {feedError}. Last records may be stale.</p>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm">{error}</p>}
    {notice && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">{notice}</p>}
    <div className="route-workspace-grid">
      <section className="report-panel" aria-label="Trip list"><div className="report-section-heading"><h2>{mode === 'synthetic' ? 'Synthetic journeys' : 'Yard trips'}</h2><span>{trips.length} records</span></div>
        <button className="report-text-link mb-3" onClick={() => { setPreviewTrip(null); setSelectedId(null) }}>Show all trips on map</button>
        {!trips.length && <p className="report-empty">{workspace ? 'No trips are assigned or linked to this yard. Preview a route and save a draft to begin.' : 'Loading assigned-yard trips.'}</p>}
        <ul className="route-trip-list">{trips.map(t => <li key={t.id}><button aria-pressed={selectedId === t.id} onClick={() => chooseTrip(t.id)}>
          <strong>{t.vehicle?.plate ?? `Trip ${t.id}`} <span className="text-xs font-normal">{t.status.replace(/_/g, ' ')}</span></strong><span>{t.origin} → {t.destination}</span>
          <small>{!t.position ? 'No reported position' : `${t.position.source} · ${t.position.stale ? 'Stale' : 'Recent'} · ${Math.floor(t.position.age_seconds / 60)} min old`}</small>
        </button></li>)}</ul>
      </section>
      <RouteMap trips={mapTrips} selectedId={previewTrip ? null : selectedId} onSelect={chooseTrip} />
    </div>
    {selected && <Section title="Trip evidence" sub={`${selected.origin} → ${selected.destination}`}>
      <div className="route-evidence-grid"><div><h3 className="font-semibold">Ordered itinerary</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{selected.routing.stops.map((s, i) => <li key={i}>{s.label} <span className="text-xs text-slate-500">{s.lat.toFixed(4)}, {s.lon.toFixed(4)}</span></li>)}</ol>{!selected.routing.stops.length && <p className="mt-3 text-sm">No recorded stop coordinates.</p>}</div>
      <div><h3 className="font-semibold">Routing source</h3><p className="mt-3 text-sm">{selected.routing.provider}</p><p className="mt-2 text-sm">{selected.routing.distance_km == null ? 'Road distance unavailable' : `${selected.routing.distance_km} km estimated`} · {selected.routing.duration_hours == null ? 'Drive time unavailable' : `${selected.routing.duration_hours} hours estimated`}</p><p className="mt-2 text-sm">Declared jurisdictions: {selected.routing.jurisdictions.join(', ') || 'Unrecorded'}. Map labels do not establish border passage.</p></div>
      <div><h3 className="font-semibold">Inspection and position evidence</h3><p className="mt-3 text-sm">{selected.context ? `Latest recorded decision: ${selected.context.latest_decision ?? 'No attempt'}. ${selected.context.rulesets.length} ruleset snapshots.` : 'No operational inspection context is linked.'}</p><p className="mt-2 text-sm">{selected.position ? `${selected.position.source} report at ${selected.position.timestamp}. ${selected.position.stale ? 'Stale position; current location is unknown.' : 'Recent report; source has not been independently verified.'}` : 'Current vehicle location is unknown.'}</p>
        {selected.context && canVisit('compliance', role) && <Link className="report-text-link mt-3" to={`/compliance?entry=${encodeURIComponent(selected.context.queue_entry)}`}>Open inspection context →</Link>}
        {canVisit('audit', role) && <Link className="report-text-link mt-3" to="/audit">Inspect yard audit →</Link>}
      </div></div><p className="report-note">A saved route or a recorded inspection decision does not grant release permission. Independent approvals and the operational gate remain authoritative.</p>
    </Section>}
    {mode === 'operational' && <Section title="Route planner" sub="Preview an itinerary, then save a yard-scoped draft. Stops are resolved in the order you enter them.">
      <form onSubmit={e => { e.preventDefault(); void preview() }}><fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Origin<input required className="field mt-1 w-full px-3" value={input.origin} onChange={e => change('origin',e.target.value)} /></label><label className="text-sm">Destination<input required className="field mt-1 w-full px-3" value={input.destination} onChange={e => change('destination',e.target.value)} /></label></div>
        <label className="block text-sm">Intermediate stops (one per line)<textarea className="field mt-1 w-full p-3" rows={2} value={input.waypoints} onChange={e => change('waypoints',e.target.value)} /></label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm">Route type<select className="field mt-1 w-full px-3" value={input.route_type} onChange={e => change('route_type',e.target.value)}><option value="DOMESTIC">Domestic</option><option value="CROSS_BORDER">Cross-border</option><option value="ABNORMAL">Abnormal</option></select></label>
          <label className="text-sm">Declared jurisdiction codes<input required className="field mt-1 w-full px-3" value={input.jurisdictions} onChange={e => change('jurisdictions',e.target.value)} placeholder="ZW, ZA" /></label>
          <label className="text-sm">Vehicle<select className="field mt-1 w-full px-3" value={input.vehicle_id} onChange={e => change('vehicle_id',e.target.value)}><option value="">Unassigned draft</option>{workspace?.vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}</select></label>
          <label className="text-sm">Driver<select className="field mt-1 w-full px-3" value={input.driver_id} onChange={e => change('driver_id',e.target.value)}><option value="">Unassigned draft</option>{workspace?.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        </div><div className="flex flex-wrap gap-3"><button className="btn-primary px-5" type="submit" disabled={busy || !workspace}>{busy ? 'Resolving route' : 'Preview road route'}</button>
          {workspace?.can_save && <button className="btn-primary px-5" type="button" disabled={busy || !previewTrip} onClick={() => void save()}>Save draft trip</button>}
        </div><p className="report-note">Preview and saving require the existing geocoding and routing services. The draft does not calculate statutory driving hours, monetary penalties or regulatory approval.</p>
      </fieldset></form>
    </Section>}
  </div>
}
