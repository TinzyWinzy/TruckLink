import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {apiFetch,facilityId} from '../lib/api'
import {useLive} from '../lib/liveGate'
import {useSession} from '../store/session'
import {StatusPill} from './ui'
export type Movement={id:number;plate:string;status:string;driver_name:string;trip_id:number|null;journey_linked:boolean;age_minutes:number;stage_wait_started_at:string|null;stage_wait_minutes:number|null;stage_wait_basis:string;context_id:number|null;attempt_id:number|null;decision:string|null;blockers:{code:string;title:string;owner:string}[];next_action:{stage:string;label:string;href:string;owner_roles:string[];assigned_person:string|null;assignment_id?:number|null;owner_available?:boolean}}
export type Operations={as_of:string;movements:Movement[];docks:number;notice:string;worklist:{mode:'active'|'latest_visits';total:number|null;limit:number;has_more:boolean|null;next_cursor:string|null}}
const titles:Record<string,string>={DISPATCH_SUPERVISOR:'Dispatch preparation',OPERATIONS_SUPERVISOR:'Loading, release and gate exit',FACILITY_MANAGER:'Handoffs and accountable owners',COMPLIANCE_OFFICER:'Blocked inspections and evidence reviews',EXECUTIVE:'Operational summary and freshness',ADMIN:'Configuration health and incomplete setup'}
export default function MovementWorklist({attention=false}:{attention?:boolean}){
  const live=useLive();const role=useSession(s=>s.role);const [data,setData]=useState<Operations|null>(null);const [error,setError]=useState('');const [pageError,setPageError]=useState('');const [loadingMore,setLoadingMore]=useState(false);const [visibleCount,setVisibleCount]=useState(5);const [retry,setRetry]=useState(0)
  useEffect(()=>{if(!live)return;let active=true;apiFetch<Operations>(`/operations/?facility=${encodeURIComponent(facilityId)}&view=active&limit=25`).then(d=>{if(!Array.isArray(d.movements))throw Error('Movement worklist response is unavailable.');if(active){setData(d);setError('');setPageError('');setVisibleCount(5)}}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[live,retry])
  async function showMore(){
    if(!data)return
    setPageError('')
    if(visibleCount<data.movements.length){setVisibleCount(n=>n+5);return}
    if(!data.worklist.has_more)return
    setLoadingMore(true)
    try{
      const next=await apiFetch<Operations>(`/operations/?facility=${encodeURIComponent(facilityId)}&view=active&limit=25&cursor=${encodeURIComponent(data.worklist.next_cursor??'')}`)
      setData(current=>current?{...next,movements:[...current.movements,...next.movements]}:next)
      setVisibleCount(n=>n+5)
    }catch(e){setPageError((e as Error).message)}
    finally{setLoadingMore(false)}
  }
  if(!live)return null
  const rows=[...(data?.movements??[])].sort((a,b)=>{
    const score=(m:Movement)=>attention?(m.blockers.length?1000000:0)+m.age_minutes:role==='OPERATIONS_SUPERVISOR'?['RELEASE','EXIT','APPROVAL'].includes(m.next_action.stage)?2:0:role==='FACILITY_MANAGER'?m.age_minutes:role==='DISPATCH_SUPERVISOR'?['FLEET','TRIP','SETUP','INSPECTION'].includes(m.next_action.stage)?2:0:m.blockers.length
    return score(b)-score(a)
  })
  return <section className="report-panel movement-worklist" aria-label="Role worklist"><div className="report-section-heading"><h2>{attention?'Movements needing attention':titles[role??'']??'Movement handoffs'}</h2><button className="btn-secondary px-3" onClick={()=>{setData(null);setError('');setPageError('');setVisibleCount(5);setRetry(n=>n+1)}}>Refresh worklist</button></div>
    {error?<p role="alert">{error} <button className="report-text-link" onClick={()=>{setError('');setRetry(n=>n+1)}}>Retry</button></p>:!data?<p role="status">Loading movement handoffs…</p>:<>
    <ul className="divide-y">{rows.slice(0,visibleCount).map(m=><li key={m.id} className="movement-row"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><strong className="movement-plate">{m.plate}</strong><StatusPill status={m.status}/></div><p className="mt-2 font-semibold">{m.next_action.label}</p><p className="mt-1 text-sm text-slate-700">{m.next_action.assigned_person?`Owner: ${m.next_action.assigned_person}${m.next_action.owner_available?'':' / reassignment required'}`:'Person unassigned'} · {m.age_minutes} minutes since arrival</p><p className="text-sm text-slate-600">{m.stage_wait_minutes===null?'Stage start not recorded':`${m.stage_wait_minutes} minutes in current stage`}</p><p className="text-sm text-slate-600">Responsible role: {m.next_action.owner_roles.map(r=>r.replaceAll('_',' ').toLowerCase()).join(' / ')}</p></div><Link className="btn-primary inline-flex items-center justify-center px-4 text-sm" to={m.next_action.href}>Open guided movement</Link></li>)}</ul>
    {!rows.length&&<p className="py-3 text-sm">No movements in this site. Begin with actual fleet and dispatch setup.</p>}
    {visibleCount<rows.length||data.worklist.has_more?<button className="btn-secondary mt-3 px-3" disabled={loadingMore} onClick={showMore}>{loadingMore?'Loading active work…':'Show next 5 active movements'}</button>:null}
    {pageError&&<p className="mt-2 text-sm" role="alert">{pageError}</p>}
    <details className="operational-details mt-3"><summary>Worklist details</summary><p className="mt-2">Read {new Date(data.as_of).toLocaleString()} · {data.movements.length} active movements loaded of {data.worklist.total??data.movements.length} total · {data.docks} configured docks.</p>{role==='ADMIN'&&!data.docks&&<p className="mt-2">Dock setup is incomplete. Configure confirmed site docks in Administration.</p>}<p className="mt-2">{data.notice}</p><Link className="report-text-link mt-2" to="/dispatch">Open dispatch lifecycle</Link></details></>}
  </section>
}
