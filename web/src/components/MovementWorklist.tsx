import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {apiFetch,facilityId} from '../lib/api'
import {useLive} from '../lib/liveGate'
import {useSession} from '../store/session'
export type Movement={id:number;plate:string;status:string;driver_name:string;trip_id:number|null;journey_linked:boolean;age_minutes:number;context_id:number|null;attempt_id:number|null;decision:string|null;blockers:{code:string;title:string;owner:string}[];next_action:{stage:string;label:string;href:string;owner_roles:string[];assigned_person:string|null;assignment_id?:number|null;owner_available?:boolean}}
export type Operations={as_of:string;movements:Movement[];docks:number;notice:string}
const titles:Record<string,string>={DISPATCH_SUPERVISOR:'Dispatch preparation',OPERATIONS_SUPERVISOR:'Loading, release and gate exit',FACILITY_MANAGER:'Handoffs and accountable owners',COMPLIANCE_OFFICER:'Blocked inspections and evidence reviews',EXECUTIVE:'Operational summary and freshness',ADMIN:'Configuration health and incomplete setup'}
export default function MovementWorklist(){
  const live=useLive();const role=useSession(s=>s.role);const [data,setData]=useState<Operations|null>(null);const [error,setError]=useState('');const [retry,setRetry]=useState(0)
  useEffect(()=>{if(!live)return;let active=true;apiFetch<Operations>(`/operations/?facility=${encodeURIComponent(facilityId)}`).then(d=>{if(!Array.isArray(d.movements))throw Error('Movement worklist response is unavailable.');if(active){setData(d);setError('')}}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[live,retry])
  if(!live)return null
  const rows=[...(data?.movements??[])].sort((a,b)=>{
    const score=(m:Movement)=>role==='OPERATIONS_SUPERVISOR'?['RELEASE','EXIT','APPROVAL'].includes(m.next_action.stage)?2:0:role==='FACILITY_MANAGER'?m.age_minutes:role==='DISPATCH_SUPERVISOR'?['FLEET','TRIP','SETUP','INSPECTION'].includes(m.next_action.stage)?2:0:m.blockers.length
    return score(b)-score(a)
  })
  return <section className="report-panel mb-5" aria-label="Role worklist"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">{titles[role??'']??'Movement handoffs'}</h2><button className="report-text-link" onClick={()=>setRetry(n=>n+1)}>Refresh worklist</button></div>
    {error?<p role="alert">{error} <button className="underline" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:!data?<p role="status">Loading movement handoffs…</p>:<><p className="mt-2 text-xs">Read {new Date(data.as_of).toLocaleString()} · {data.movements.length} visits in loaded window · {data.docks} configured docks</p>
    <ul className="mt-3 divide-y">{rows.slice(0,5).map(m=><li key={m.id} className="py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{m.plate} / Visit {m.id} / {m.status}</strong><Link className="report-text-link" to={m.next_action.href}>Open guided movement</Link></div><p className="mt-1">{m.next_action.label}</p><p className="text-xs">Responsible role: {m.next_action.owner_roles.map(r=>r.replaceAll('_',' ').toLowerCase()).join(' / ')} · {m.next_action.assigned_person?`Owner: ${m.next_action.assigned_person}${m.next_action.owner_available?'':' / reassignment required'}`:'Person unassigned'} · {m.age_minutes} minutes since arrival</p></li>)}</ul>
    {!rows.length&&<p className="mt-3 text-sm">No movements in this site. Begin with actual fleet and dispatch setup.</p>}{role==='ADMIN'&&!data.docks&&<p className="mt-2 text-sm">Dock setup is incomplete. Configure confirmed site docks in Administration.</p>}<Link className="report-text-link mt-3" to="/dispatch">Open dispatch lifecycle</Link><p className="mt-2 text-xs">{data.notice}</p></>}
  </section>
}
