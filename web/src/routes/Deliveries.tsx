import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch, facilityId } from '../lib/api'
import { useLive } from '../lib/liveGate'
import { useSession } from '../store/session'
import type { RouteTrip, RouteWorkspace } from '../lib/routes'
import type { Journey } from '../lib/journey'
import JourneyPanel from '../components/JourneyPanel'
import { PageHeader, Section } from '../components/ui'

type Board={records:{trip:RouteTrip;journey:Pick<Journey,'trip_id'|'visit_id'|'stage'|'next_action'|'delivery_stops'|'returns'|'closure'|'integrations'>}[];total:number;page:number;page_size:number;as_of:string;scope:string;facility:RouteWorkspace['facility'];organisation:RouteWorkspace['organisation']}
const human=(text:string)=>text.replaceAll('_',' ').toLowerCase()
export default function Deliveries(){
  const live=useLive();const role=useSession(s=>s.role);const [params,setParams]=useSearchParams();const [data,setData]=useState<Board|null>(null)
  const [error,setError]=useState('');const [version,setVersion]=useState(0);const [query,setQuery]=useState(params.get('q')??'')
  const [filter,setFilter]=useState('all');const page=Math.max(1,Number(params.get('page'))||1);const search=params.get('q')??'';const selectedId=Number(params.get('trip'))
  // eslint-disable-next-line react/set-state-in-effect -- Do not show records from the previous page while fetching another page.
  useEffect(()=>{if(!live)return;let active=true;setData(null);setError('')
    apiFetch<Board>(`/deliveries/?facility=${encodeURIComponent(facilityId)}&page=${page}&q=${encodeURIComponent(search)}`).then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError((e as Error).message)})
    return()=>{active=false}
  },[live,page,search,version])
  const exception=(journey:Board['records'][number]['journey'])=>['DELIVERY_REJECTED','DELIVERY_REATTEMPT_PLANNED','STOPS_COMPLETE_RETURNS_OPEN'].includes(journey.stage)||journey.returns?.some(r=>r.state!=='RETURN_RECEIVED')
  const rows=data?.records.filter(row=>filter==='all'||filter==='exceptions'&&exception(row.journey)||filter==='destination'&&['DEPARTED','DESTINATION_ARRIVED'].includes(row.journey.stage)||filter==='closure'&&['DELIVERY_ACCEPTED','COMPLETED_WITH_RETURNS'].includes(row.journey.stage))??[]
  const selected=data?.records.find(row=>row.trip.id===selectedId)
  function change(key:string,value:string){const next=new URLSearchParams(params);next.set(key,value);if(key!=='trip')next.delete('trip');setParams(next)}
  return <div className="space-y-5"><PageHeader title="Deliveries & exceptions" sub="Follow linked movements through destination, reattempts and returns." mode={live?'live':'demo'}/>
    {!live?<Section title="Connected delivery workspace"><p>Sign in to see journeys originating at your selected yard.</p></Section>:<>
      <div className="flex flex-wrap items-end gap-3"><form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setParams({q:query,page:'1'})}}><label className="text-sm">Search vehicle, driver, destination or ERP reference<input className="field mt-1 block w-full" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="btn-primary min-h-12 px-4">Search</button></form><label className="text-sm">Show on this page<select className="field mt-1 block" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All stages</option><option value="exceptions">Exceptions and open returns</option><option value="destination">Travelling or at destination</option><option value="closure">Physical delivery complete</option></select></label><button className="report-text-link" onClick={()=>setVersion(n=>n+1)}>Refresh deliveries</button></div>
      {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={()=>setVersion(n=>n+1)}>Retry</button></p>}
      {!data&&!error?<p role="status">Loading linked journeys…</p>:data&&<>
        <p className="text-sm text-slate-600">{data.scope} Read {new Date(data.as_of).toLocaleString()}. Showing {rows.length} of {data.records.length} on page {data.page}; {data.total} matching journeys.</p>
        {selected&&<Section title={`${selected.trip.vehicle?.plate??'Unassigned vehicle'} · Trip ${selected.trip.id}`}><Link className="report-text-link" to={`/routes?trip=${selected.trip.id}`}>Open route and reported position</Link><JourneyPanel key={selected.trip.id} trip={selected.trip} workspace={{trips:data.records.map(r=>r.trip),vehicles:[],drivers:[],can_save:false,facility:data.facility,organisation:data.organisation}} onChange={()=>setVersion(n=>n+1)}/></Section>}
        <Section title="Movement board">{rows.length===0?<p>{data.total===0?'No linked journeys found. Link a trip and origin visit in Dispatch flow to begin.':'No journeys match this page filter.'} <Link className="report-text-link" to="/dispatch">Open Dispatch flow</Link></p>:<ul className="grid gap-4 xl:grid-cols-2">{rows.map(({trip,journey})=><li key={trip.id} className={`min-w-0 rounded-xl border p-4 ${exception(journey)?'border-red-200 bg-red-50/40':'border-slate-200'}`}><div className="flex flex-wrap justify-between gap-2"><h3 className="text-lg font-bold">{trip.vehicle?.plate??'Unassigned vehicle'}</h3><span className={`rounded-lg px-2 py-1 text-sm font-semibold ${exception(journey)?'bg-red-100 text-red-800':'bg-slate-100 text-slate-700'}`}>{human(journey.stage)}</span></div><p className="mt-2 break-words text-sm">Trip {trip.id} · {trip.driver?.name??'Driver unassigned'}<br/>{trip.origin} → {trip.destination}</p><p className="mt-3 font-semibold">{journey.next_action?.label??'Review journey'}</p><p className="mt-1 text-sm">Responsible: {journey.next_action?.owner_roles.map(human).join(', ')??'Review required'}</p><p className="mt-2 text-sm">Stops resolved: {journey.delivery_stops?.filter(s=>s.resolved).length??0} / {journey.delivery_stops?.length??0} · Open returns: {journey.returns?.filter(r=>r.state!=='RETURN_RECEIVED').length??0}</p><details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">Closure and integration details</summary><p>ERP: {human(journey.integrations.erp)} · Tracker: {human(journey.integrations.tracking)}</p><p>Physical delivery: {human(journey.closure?.physical_delivery??'OPEN')} · Commercial closure: {human(journey.closure?.commercial??'NOT_CONFIRMED')}</p></details><button className="btn-primary mt-3 min-h-12 px-4" onClick={()=>change('trip',String(trip.id))}>{journey.next_action?.owner_roles.includes(role??'')?'Open next action':'View journey'}</button></li>)}</ul>}</Section>
        <div className="flex flex-wrap items-center gap-3"><button className="route-mode-button min-h-12" disabled={page<=1} onClick={()=>change('page',String(page-1))}>Previous page</button><span className="text-sm">Page {page}</span><button className="route-mode-button min-h-12" disabled={page*data.page_size>=data.total} onClick={()=>change('page',String(page+1))}>Next page</button></div>
      </>}
    </>}
  </div>
}
