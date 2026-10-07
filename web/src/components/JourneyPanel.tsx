import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, ApiError, facilityId } from '../lib/api'
import { useSession } from '../store/session'
import type { RouteTrip, RouteWorkspace } from '../lib/routes'

type Visit = { id: number; reg_number: string; status: string }
type Journey = {
  id: number; trip_id: number; visit_id: number; stage: string; yard_status: string; dock: string | null;
  integrations: { erp: string; tracking: string };
  external_reference: { system: string; reference: string } | null;
  milestone_semantics?: string; dock_occupied?: boolean;
  next_action?: { kind: string | null; label: string; owner_roles: string[]; href: string | null; scope: string | null };
  closure?: { physical_delivery: string; evidence: string; erp: string; commercial: string };
  events: { id: string; kind: string; at: string; actor_id: number | null; decision?: string; reason?: string }[];
}
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,19)

export default function JourneyPanel({ trip, workspace, onChange }: { trip: RouteTrip; workspace: RouteWorkspace; onChange: () => void }) {
  const role = useSession(s => s.role)
  const [journey,setJourney] = useState<Journey | null>(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [visit,setVisit] = useState(trip.context?.queue_entry ?? '')
  const [system,setSystem] = useState('')
  const [reference,setReference] = useState('')
  const [reason,setReason] = useState('')
  const [observed,setObserved] = useState(localNow)
  const [receiver,setReceiver] = useState('')
  const [document,setDocument] = useState('')
  const [sha,setSha] = useState('')
  const [outcome,setOutcome] = useState('DELIVERY_ACCEPTED')
  const [replayKey,setReplayKey] = useState(() => crypto.randomUUID())
  const visits = (workspace as RouteWorkspace & { visits?: Visit[] }).visits ?? []
  useEffect(() => {
    let active = true
    const load = () => apiFetch<{ journey: Journey }>(`/trips/${trip.id}/journey/`).then(data => {
      if (active) setJourney(data.journey)
    }).catch(e => { if (active && !(e instanceof ApiError && e.status === 404)) setError((e as Error).message) })
      .finally(() => { if (active) setLoading(false) })
    void load()
    const timer = window.setInterval(() => void load(),10000)
    return () => { active = false; clearInterval(timer) }
  },[trip.id])
  const legacyNext = journey?.stage === 'AT_ORIGIN' || journey?.stage === 'YARD_RELEASE_AUTHORISED' ? 'DEPARTED'
    : journey?.stage === 'DEPARTED' ? 'DESTINATION_ARRIVED' : journey?.stage === 'DESTINATION_ARRIVED' ? outcome : null
  const next = journey?.next_action ? journey.next_action.kind === 'DELIVERY_OUTCOME' ? outcome : journey.next_action.kind : legacyNext
  const canObserve = journey?.next_action ? journey.next_action.owner_roles.includes(role ?? '')
    : next === 'DEPARTED' ? ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER'].includes(role ?? '')
    : ['OPERATIONS_SUPERVISOR','FACILITY_MANAGER'].includes(role ?? '')
  const delivery = next === 'DELIVERY_ACCEPTED' || next === 'DELIVERY_REJECTED'
  async function link() {
    setBusy(true); setError('')
    try {
      const result = await apiFetch<{ journey: Journey }>(`/trips/${trip.id}/journey/`,{ method:'POST',body:{
        facility:facilityId,visit_id:Number(visit),reason,external_system:system,external_reference:reference,
      } })
      setJourney(result.journey); setReason(''); onChange()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function record() {
    setBusy(true); setError('')
    try {
      const result = await apiFetch<{ journey: Journey }>(`/trips/${trip.id}/journey/events/`,{method:'POST',body:{
        kind:next,observed_at:new Date(observed).toISOString(),client_key:replayKey,reason,
        details:delivery ? {receiver,evidence_reference:document,evidence_sha256:sha} : {},
      }})
      setJourney(result.journey); setReplayKey(crypto.randomUUID()); setReason(''); setObserved(localNow())
      if (delivery) { setReceiver(''); setDocument(''); setSha(''); setOutcome('DELIVERY_ACCEPTED') }
      onChange()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="report-panel mt-4" aria-label="Connected journey">
    <h2 className="text-lg font-bold">Registration to destination</h2>
    <p className="mt-2 text-sm">ERP and tracking connectors are not configured. Existing position reports remain separate evidence.</p>
    {loading && <p role="status">Loading journey.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!loading && !journey && <>
      <p className="mt-3 text-sm">Link an origin yard visit to this assigned trip. Inspection history and registered vehicle must agree.</p>
      {workspace.can_save && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Origin yard visit<select className="field mt-1 w-full" value={visit} onChange={e=>setVisit(e.target.value)}>
          <option value="">Choose a registered visit</option>{visits.map(v=><option key={v.id} value={v.id}>{v.reg_number} / visit {v.id} / {v.status}</option>)}
        </select></label>
        <label className="text-sm">Reason for linking<input className="field mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <label className="text-sm">External system name (optional)<input className="field mt-1 w-full" value={system} onChange={e=>setSystem(e.target.value)}/></label>
        <label className="text-sm">Dispatch reference (optional)<input className="field mt-1 w-full" value={reference} onChange={e=>setReference(e.target.value)}/></label>
        <p className="text-xs sm:col-span-2">A manually recorded dispatch reference does not confirm an ERP import or acknowledgement.</p>
        <button className="btn-primary px-4" disabled={busy || !visit || !reason.trim() || Boolean(system)!==Boolean(reference)} onClick={()=>void link()}>Link origin visit</button>
      </div>}
    </>}
    {journey && <>
      <p className="mt-3 text-sm font-semibold">Journey {journey.id} / Trip {trip.id} / Visit {journey.visit_id}</p>
      <p className="mt-1 text-sm">{journey.stage.replaceAll('_',' ')} · Yard: {journey.yard_status}{journey.dock ? ` · Assigned dock: ${journey.dock}${journey.dock_occupied === false ? ' (no longer occupied by this visit)' : ''}` : ''}</p>
      {journey.external_reference && <p className="mt-1 break-words text-sm">Recorded reference: {journey.external_reference.system} / {journey.external_reference.reference}</p>}
      {journey.milestone_semantics === 'LEGACY_COMBINED' && <p className="mt-2 text-sm text-amber-800">Historical release combines yard milestones. Its exit timestamp does not independently prove physical departure.</p>}
      {journey.next_action && <div className="mt-3 rounded-lg border border-slate-200 p-3" aria-label="Next journey task">
        <p className="font-semibold">Next: {journey.next_action.label}</p>
        <p className="mt-1 text-sm">Responsible roles: {journey.next_action.owner_roles.map(r=>r.replaceAll('_',' ').toLowerCase()).join(', ')}.</p>
        {journey.next_action.scope && <p className="mt-2 text-sm">{journey.next_action.scope}</p>}
        {journey.next_action.href && <div className="mt-2 flex flex-wrap gap-4"><Link className="report-text-link" to={journey.next_action.href}>{journey.next_action.href === '/queue' ? 'Open release queue' : 'Open inspection'} →</Link>{journey.next_action.href !== '/queue' && <Link className="report-text-link" to="/queue">Open release queue →</Link>}</div>}
      </div>}
      {journey.stage === 'DELIVERY_ACCEPTED' && <p className="mt-3 text-sm">Physical delivery accepted by staff attestation. Evidence reference and fingerprint recorded; reconciliation remains outstanding. ERP acknowledgement and commercial closure are not confirmed.</p>}
      <ol className="mt-4 space-y-3">{journey.events.map(event=><li key={event.id} className="border-l-2 border-slate-200 pl-3 text-sm">
        <strong>{event.kind.replaceAll('_',' ')}</strong>{event.decision && `: ${event.decision}`}<p>{new Date(event.at).toLocaleString()} · {event.actor_id ? `Staff ${event.actor_id}` : 'Actor unrecorded'}</p>{event.reason && <p>{event.reason}</p>}
      </li>)}</ol>
      {next && canObserve && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <p className="text-sm sm:col-span-2">{next === 'DELIVERY_REATTEMPT_PLANNED' ? 'Record the agreed reason and plan for another attempt at the existing destination. The trip and its rejected receipt remain unchanged.' : 'Record a staff observation. Yard release does not prove physical departure; arrival does not prove accepted delivery.'}</p>
        <label className="text-sm">Observation time<input type="datetime-local" step="1" className="field mt-1 w-full" value={observed} onChange={e=>setObserved(e.target.value)}/><button type="button" className="report-text-link mt-1" onClick={()=>setObserved(localNow())}>Use current time</button></label>
        <label className="text-sm">Observation reason<input className="field mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>
        {delivery && <>
          <label className="text-sm">Delivery outcome<select className="field mt-1 w-full" value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="DELIVERY_ACCEPTED">Accepted</option><option value="DELIVERY_REJECTED">Rejected</option></select></label>
          <label className="text-sm">Receiver name<input className="field mt-1 w-full" value={receiver} onChange={e=>setReceiver(e.target.value)}/></label>
          <label className="text-sm">Delivery evidence reference<input className="field mt-1 w-full" value={document} onChange={e=>setDocument(e.target.value)}/></label>
          <label className="min-w-0 text-sm">Fingerprint delivery document<input type="file" className="mt-1 block w-full text-xs" onChange={async e=>{
            setSha(''); const file=e.target.files?.[0]; if(!file)return
            try { const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()); setSha(Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('')) }
            catch { setError('Could not fingerprint document. Please select it again.') }
          }}/><span className="mt-1 block text-xs">{sha ? 'Fingerprint ready. ' : ''}File stays on this device. Retain it at the evidence reference.</span></label>
        </>}
        <button className="btn-primary px-4" disabled={busy || !reason.trim() || !observed || (next==='DEPARTED' && journey.yard_status!=='RELEASED') || (delivery && (!receiver.trim() || !document.trim() || !sha))} onClick={()=>void record()}>Record {next.replaceAll('_',' ').toLowerCase()}</button>
      </div>}
    </>}
  </section>
}
