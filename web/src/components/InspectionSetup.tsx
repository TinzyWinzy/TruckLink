import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Section } from './ui'

export type InspectionSetupData = {
  entry:{id:number;registration:string;status:string};can_record_context:boolean;can_record_load:boolean;
  linked_trip_id:number|null;
  current_context:{id:number;configuration:number;driver:number;trip:number;load:number;route_type:string;jurisdictions:string[];origin:string;destination:string;evidence_ids:number[]}|null;
  blockers:{code:string;title:string;owner:string}[];
  trips:{id:number;origin:string;destination:string;driver:number;driver_name:string;vehicle:number;routing_snapshot?:{route_type?:string;jurisdictions?:string[]}}[];
  configurations:{id:number;revision:number;vehicle:number;vehicle_class:string;usable:boolean}[];
  loads:{id:number;reference:string;cargo_class:string;declared_mass_kg:string}[];
  evidence:{id:number;kind:string;document_ref:string;review_status:string;vehicle:number|null;driver:number|null;trip:number|null;load:number|null}[];
}

export default function InspectionSetup({entryId,onSaved,showBlockers=true}:{entryId:string;onSaved:()=>Promise<void>;showBlockers?:boolean}) {
  const [data,setData]=useState<InspectionSetupData|null>(null)
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false)
  const [tripId,setTripId]=useState(''); const [configuration,setConfiguration]=useState(''); const [loadId,setLoadId]=useState('')
  const [routeType,setRouteType]=useState('DOMESTIC'); const [jurisdictions,setJurisdictions]=useState('')
  const [origin,setOrigin]=useState(''); const [destination,setDestination]=useState(''); const [evidence,setEvidence]=useState<number[]>([])
  const [load,setLoad]=useState({reference:'',cargo_class:'',declared_mass_kg:''})
  const refresh=()=>apiFetch<InspectionSetupData>(`/regulatory/queue/${entryId}/setup/`).then(setData)
  useEffect(()=>{let active=true; apiFetch<InspectionSetupData>(`/regulatory/queue/${entryId}/setup/`).then(d=>{if(!active)return;setData(d)
    setConfiguration('');setLoadId('');setOrigin('');setDestination('');setRouteType('DOMESTIC');setJurisdictions('');setEvidence([])
    const saved=d.current_context
    const tripId=d.linked_trip_id??saved?.trip
    setTripId(tripId?String(tripId):'')
    if(saved){setConfiguration(String(saved.configuration));setLoadId(String(saved.load));setOrigin(saved.origin);setDestination(saved.destination)
      setRouteType(saved.route_type);setJurisdictions(saved.jurisdictions.join(', '));setEvidence(saved.evidence_ids)}
    else if(tripId){const trip=d.trips.find(t=>t.id===tripId);if(trip){setOrigin(trip.origin);setDestination(trip.destination)
      setRouteType(trip.routing_snapshot?.route_type??'DOMESTIC');setJurisdictions(trip.routing_snapshot?.jurisdictions?.join(', ')??'')}}
  }).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[entryId])
  const trip=data?.trips.find(t=>String(t.id)===tripId)
  const documents=data?.evidence.filter(e=>(!!trip&& (e.vehicle===trip.vehicle||e.driver===trip.driver||e.trip===trip.id))||e.load===Number(loadId))??[]
  async function saveLoad(){
    setBusy(true);setError('')
    try{const result=await apiFetch<{record:{id:number}}>('/regulatory/loads/',{method:'POST',body:load});await refresh();setLoadId(String(result.record.id));setLoad({reference:'',cargo_class:'',declared_mass_kg:''})}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function save(){
    if(!trip)return
    setBusy(true);setError('')
    try{
      await apiFetch(`/regulatory/queue/${entryId}/context/`,{method:'POST',body:{configuration:Number(configuration),trip:trip.id,driver:trip.driver,load:Number(loadId),
        origin,destination,route_type:routeType,jurisdictions:jurisdictions.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean),evidence_ids:evidence}})
      await onSaved()
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Section title="Prepare this inspection" sub="Saving setup does not authorise release.">
    {error&&<p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}
    {!data?<p role="status">Loading entry setup.</p>:<>
      <p className="text-sm font-bold">{data.entry.registration} · Visit {data.entry.id} · {data.entry.status}</p>
      {showBlockers&&data.blockers.length>0&&<ol className="prerequisite-list">{data.blockers.map(b=><li key={b.code}><div><strong>{b.title}</strong><p>Responsible role: {b.owner}</p></div></li>)}</ol>}
      <details className="operational-details my-3"><summary>Setup responsibilities</summary><p>Dispatch manages trips in <Link className="underline" to="/routes">Routes & map</Link>. Admin manages vehicle evidence in <Link className="underline" to="/admin">Admin</Link>. Compliance uses <Link className="underline" to="/approvals">Pending approvals</Link>. A different person must approve rating evidence and configurations.</p></details>
      {!data.can_record_context?<p className="text-sm">An operations or dispatch supervisor must record setup. Released visits retain their historical context.</p>:<div className="grid gap-4 sm:grid-cols-2">
        {data.current_context&&<p className="text-sm sm:col-span-2">Previous setup loaded. Review it and save again only if details need updating.</p>}
        <label className="text-sm font-bold">Assigned trip<select className="field mt-1 w-full" value={tripId} onChange={e=>{
          setTripId(e.target.value);setConfiguration('');setEvidence([]);const t=data.trips.find(t=>String(t.id)===e.target.value)
          if(t){setOrigin(t.origin);setDestination(t.destination);setRouteType(t.routing_snapshot?.route_type??'DOMESTIC');setJurisdictions(t.routing_snapshot?.jurisdictions?.join(', ')??'')}
        }}><option value="">Choose a matching trip</option>{data.trips.map(t=><option key={t.id} value={t.id}>Trip {t.id}: {t.origin} to {t.destination} / {t.driver_name}</option>)}</select></label>
        <label className="text-sm font-bold">Reviewed vehicle configuration<select className="field mt-1 w-full" value={configuration} onChange={e=>setConfiguration(e.target.value)}><option value="">Choose current evidenced ratings</option>{data.configurations.filter(c=>!trip||c.vehicle===trip.vehicle).map(c=><option key={c.id} value={c.id} disabled={!c.usable}>{c.vehicle_class} / revision {c.revision}{!c.usable?' / requires current independent review':''}</option>)}</select></label>
        <label className="text-sm font-bold">Load<select className="field mt-1 w-full" value={loadId} onChange={e=>{setLoadId(e.target.value);setEvidence([])}}><option value="">Choose the dispatched load</option>{data.loads.map(l=><option key={l.id} value={l.id}>{l.reference} / {l.cargo_class} / {l.declared_mass_kg} kg declared</option>)}</select></label>
        <label className="text-sm font-bold">Route type<select className="field mt-1 w-full" value={routeType} onChange={e=>setRouteType(e.target.value)}>{['DOMESTIC','CROSS_BORDER','ABNORMAL'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label className="text-sm font-bold">Origin<input className="field mt-1 w-full" value={origin} onChange={e=>setOrigin(e.target.value)}/></label>
        <label className="text-sm font-bold">Destination<input className="field mt-1 w-full" value={destination} onChange={e=>setDestination(e.target.value)}/></label>
        <label className="text-sm font-bold sm:col-span-2">Traversed jurisdiction codes<input placeholder="For example: ZW, ZA" className="field mt-1 w-full" value={jurisdictions} onChange={e=>setJurisdictions(e.target.value)}/></label>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-bold">Supporting evidence for this assignment</legend>{documents.length===0?<p className="mt-2 text-sm">No supporting documents recorded for the selected assignment. Vehicle-rating evidence is included automatically.</p>:documents.map(d=><label key={d.id} className="flex min-h-12 items-center gap-3 break-all text-sm"><input type="checkbox" checked={evidence.includes(d.id)} onChange={e=>setEvidence(old=>e.target.checked?[...old,d.id]:old.filter(id=>id!==d.id))}/>{d.kind} / {d.document_ref} / {d.review_status}</label>)}</fieldset>
        <button className="btn-primary min-h-12 px-4 sm:col-span-2" disabled={busy||!trip||!configuration||!loadId||!origin.trim()||!destination.trim()||!jurisdictions.trim()} onClick={()=>void save()}>Save operational setup</button>
      </div>}
      {data.can_record_load&&<details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm font-bold">Record a missing load</summary><div className="mt-3 grid gap-3 sm:grid-cols-3">
        {Object.entries({reference:'Load / manifest reference',cargo_class:'Cargo class',declared_mass_kg:'Declared cargo mass (kg)'}).map(([key,label])=><label key={key} className="text-sm">{label}<input className="field mt-1 w-full" type={key==='declared_mass_kg'?'number':'text'} min="0" step="0.001" value={load[key as keyof typeof load]} onChange={e=>setLoad(old=>({...old,[key]:e.target.value}))}/></label>)}
        <button className="btn-primary min-h-12 px-4" disabled={busy||!load.reference.trim()||!load.cargo_class.trim()||load.declared_mass_kg===''} onClick={()=>void saveLoad()}>Record load</button>
      </div></details>}
    </>}
  </Section>
}
