import {useEffect,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {apiFetch,facilityId} from '../lib/api'
import {useLive} from '../lib/liveGate'
import {useSession} from '../store/session'
import {canVisit} from '../lib/gates'
import {PageHeader,Section} from '../components/ui'
import FleetRegistration from '../components/FleetRegistration'
import VehicleEvidenceDesk from '../components/VehicleEvidenceDesk'
import VersionedInspection from '../components/VersionedInspection'
import InspectionSetup from '../components/InspectionSetup'
import JourneyPanel from '../components/JourneyPanel'
import MovementDock from '../components/MovementDock'
import MovementOwner from '../components/MovementOwner'
import {getRegulatoryContext,type RegulatoryContext} from '../lib/regulatory'
import type {RouteWorkspace} from '../lib/routes'
import type {Operations} from '../components/MovementWorklist'
import RoutesMap from './RoutesMap'
import PendingApprovals from './PendingApprovals'
import {queueEntrySchema} from '../lib/validation/compliance'
import {enqueueOfflineAction,isOnline} from '../lib/offline/db'

const stages=[['FLEET','Vehicle + driver'],['TRIP','Trip + visit link'],['EVIDENCE','Evidence review'],['SETUP','Load + context'],['INSPECTION','Inspection'],['APPROVAL','Approval'],['RELEASE','Release'],['EXIT','Gate exit'],['JOURNEY','Delivery']] as const
export default function DispatchFlow(){
  const live=useLive();const role=useSession(s=>s.role);const [params,setParams]=useSearchParams()
  const entry=params.get('entry')??'';const [data,setData]=useState<Operations|null>(null);const [context,setContext]=useState<RegulatoryContext|null>(null);const [routes,setRoutes]=useState<RouteWorkspace|null>(null)
  const [step,setStep]=useState('');const [retry,setRetry]=useState(0);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('')
  const [arrival,setArrival]=useState({licensePlate:'',driverName:'',cargoType:'',expectedDestination:''})
  const movement=data?.movements.find(m=>String(m.id)===entry)
  const current=step||movement?.next_action.stage||'FLEET'
  async function refresh(){setRetry(n=>n+1)}
  useEffect(()=>{if(!live)return;let active=true
    apiFetch<Operations>(`/operations/?facility=${encodeURIComponent(facilityId)}${entry?`&entry=${encodeURIComponent(entry)}`:""}`).then(d=>{if(active){setData(d);setError('')}}).catch(e=>{if(active)setError((e as Error).message)})
    if(entry){getRegulatoryContext(entry).then(d=>{if(active)setContext(d)}).catch(e=>{if(active)setError((e as Error).message)});apiFetch<RouteWorkspace>(`/routes/workspace/?facility=${encodeURIComponent(facilityId)}`).then(d=>{if(active)setRoutes(d)}).catch(e=>{if(active)setError((e as Error).message)})}
    return()=>{active=false}
  },[live,entry,retry])
  async function register(){
    const parsed=queueEntrySchema.safeParse(arrival)
    if(!parsed.success){setError(parsed.error.issues[0]?.message??'Complete arrival details');return}
    setBusy(true);setError('');setNotice('')
    try{if(!isOnline()){await enqueueOfflineAction('queue.create',parsed.data);setNotice('Arrival saved offline. Reconnect and review sync before selecting the server visit.')}else{await (await import('../lib/live')).registerVehicleLive(parsed.data,crypto.randomUUID());setNotice('Arrival registered. Refresh and select its visit.');await refresh()}setArrival({licensePlate:'',driverName:'',cargoType:'',expectedDestination:''})}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function release(){setBusy(true);setError('');try{await (await import('../lib/live')).releaseVehicleLive(entry);setStep('');await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const trip=routes?.trips.find(t=>t.id===movement?.trip_id)
  return <div className="space-y-5"><PageHeader title="Guided dispatch" sub="Keep the movement, prerequisites and handoffs together. Each command still checks tenant permissions and current evidence on the server." mode={live?'live':'demo'}/>
    {!live?<Section title="Practice boundary"><p className="text-sm">This local practice session does not execute a tenant dispatch. A complete lifecycle test requires an isolated training workspace, separate staff accounts and synthetic policy explicitly labelled as training.</p><Link className="report-text-link" to="/guide">Open the walkthrough</Link></Section>:<>
      {error&&<p role="alert">{error} <button className="underline" onClick={()=>void refresh()}>Retry</button></p>}{notice&&<p role="status">{notice}</p>}
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-bold">Movement visit<select className="field mt-1 w-full" value={entry} onChange={e=>{setParams(e.target.value?{entry:e.target.value}:{});setStep('');setContext(null);setRoutes(null)}}><option value="">Prepare fleet or choose a registered arrival</option>{data?.movements.map(m=><option key={m.id} value={m.id}>{m.plate} / Visit {m.id} / {m.status}</option>)}</select></label><button className="report-text-link" onClick={()=>void refresh()}>Refresh movement</button></div>
      {!data&&!error&&<p role="status">Loading assigned-site movements…</p>}
      {!entry&&['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR'].includes(role??'')&&<details className="card p-4"><summary className="cursor-pointer font-bold">Register an observed arrival</summary><p className="my-2 text-sm">Prepare fleet and trip first if known. Record arrival only when the truck reaches this site.</p><div className="grid gap-3 sm:grid-cols-2">{Object.entries({licensePlate:'Arrival vehicle registration',driverName:'Arrival driver',cargoType:'Arrival cargo',expectedDestination:'Arrival destination'}).map(([key,label])=><label key={key} className="text-sm">{label}<input className="field mt-1 w-full" value={arrival[key as keyof typeof arrival]} onChange={e=>setArrival(old=>({...old,[key]:e.target.value}))}/></label>)}<button className="btn-primary px-4" disabled={busy} onClick={()=>void register()}>Register observed arrival</button></div></details>}
      {movement&&<Section title={`${movement.plate} / Visit ${movement.id}`} sub={`Status: ${movement.status} / Driver: ${movement.driver_name||'Unrecorded'}`}><p className="font-bold">Next: {movement.next_action.label}</p><p className="mt-1 text-sm">Responsible role: {movement.next_action.owner_roles.map(r=>r.replaceAll('_',' ').toLowerCase()).join(' / ')}. Assigned person: {movement.next_action.assigned_person||'unassigned'}.{movement.next_action.assigned_person&&!movement.next_action.owner_available&&' Reassignment required: this owner is no longer eligible at this site.'}</p><MovementOwner entryId={movement.id} stage={movement.next_action.stage} assignmentId={movement.next_action.assignment_id} onChanged={()=>{void refresh()}}/><ul className="mt-3 space-y-2 text-sm">{movement.blockers.map(b=><li key={b.code}><strong>{b.code}:</strong> {b.title} / {b.owner}</li>)}</ul><p className="mt-2 text-xs">Record availability does not certify validity. The current inspection and release checks remain authoritative.</p></Section>}
      <button className="report-text-link" onClick={()=>{setStep('');void refresh()}}>Show next required stage</button>
      <nav className="flex flex-wrap gap-2" aria-label="Dispatch stages">{stages.map(([id,label])=><button key={id} className={`rounded border px-3 py-2 text-sm font-bold ${current===id?'bg-slate-900 text-white':'bg-white text-slate-900'}`} aria-pressed={current===id} onClick={()=>setStep(id)}>{label}</button>)}</nav>
      {current==='FLEET'&&(role==='ADMIN'?<FleetRegistration/>:<Section title="Vehicle and driver setup"><p className="text-sm">Fleet administration registers actual vehicle and driver records. Your role cannot create them here. Continue to Trip once they are available.</p></Section>)}
      {current==='TRIP'&&<RoutesMap onChanged={()=>{void refresh()}}/>}
      {current==='EVIDENCE'&&(['ADMIN','COMPLIANCE_OFFICER'].includes(role??'')?<VehicleEvidenceDesk/>:<Section title="Independent evidence review"><p className="text-sm">The evidence author and a different authorised reviewer complete this handoff. Refresh this movement afterwards.</p>{canVisit('approvals',role)&&<Link className="report-text-link" to="/approvals">Open pending approvals</Link>}</Section>)}
      {current==='SETUP'&&entry&&<><MovementDock entryId={Number(entry)} onChanged={()=>{void refresh()}}/><InspectionSetup key={entry} entryId={entry} onSaved={async()=>{setStep('');await refresh()}}/></>}
      {current==='INSPECTION'&&entry&&(context?<VersionedInspection key={`${entry}:${context.context?.id}:${context.attempt?.id}`} entryId={entry} data={context} changeEntry={id=>{setParams({entry:id});setContext(null)}} onChanged={()=>{void refresh()}}/>:<p role="status">Loading inspection context…</p>)}
      {current==='APPROVAL'&&(canVisit('approvals',role)?<PendingApprovals/>:<Section title="Independent approval"><p className="text-sm">A separate authorised operations reviewer must decide the pending request.</p></Section>)}
      {current==='RELEASE'&&movement&&<Section title="Separate release decision"><p className="text-sm">Release is checked against the latest inspection, current evidence and any independent approval. It does not record physical exit.</p>{['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER'].includes(role??'')&&<button className="btn-primary mt-3 px-4" disabled={busy||!movement.journey_linked||!['COMPLETED','OVERRIDE_APPROVED'].includes(movement.status)} onClick={()=>void release()}>Authorise yard release</button>}{!movement.journey_linked&&<p className="mt-2 text-sm">Link the assigned trip and origin visit before releasing through this guided flow.</p>}</Section>}
      {['EXIT','JOURNEY'].includes(current)&&entry&&(trip&&routes?<JourneyPanel trip={trip} workspace={routes} onChange={()=>{void refresh()}}/>:<Section title="Movement handoff"><p className="text-sm">A linked, assigned trip is required for observed gate exit and delivery. Check the Trip stage.</p></Section>)}
      {!entry&&!['FLEET','TRIP','EVIDENCE'].includes(current)&&<p className="text-sm">Select a registered arrival to work on this stage.</p>}
      <p className="text-xs">Refresh after another person's handoff. No stage selection performs an operation or grants approval.</p>
    </>}
  </div>
}
