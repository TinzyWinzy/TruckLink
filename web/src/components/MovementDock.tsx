import {useEffect,useState} from 'react'
import {apiFetch,facilityId} from '../lib/api'
import {useSession} from '../store/session'
type Dock={id:number;name:string;status:string;current_entry:number|null}
export default function MovementDock({entryId,onChanged}:{entryId:number;onChanged:()=>void}){
  const role=useSession(s=>s.role);const [docks,setDocks]=useState<Dock[]|null>(null);const [selected,setSelected]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [retry,setRetry]=useState(0)
  useEffect(()=>{let active=true;apiFetch<{docks:Dock[]}>(`/docks/?facility=${encodeURIComponent(facilityId)}`).then(d=>{if(active){setDocks(d.docks);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[retry])
  async function assign(){setBusy(true);try{await apiFetch(`/docks/${selected}/assign/`,{method:'POST',body:{queue_entry:entryId}});setRetry(n=>n+1);onChanged()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const current=docks?.find(d=>d.current_entry===entryId)
  return <section className="report-panel mb-4"><h2 className="font-bold">Loading dock</h2>{error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:!docks?<p role="status">Loading docks…</p>:current?<p className="text-sm">Assigned: {current.name} · {current.status}</p>:!docks.length?<p className="text-sm">No site docks configured. Admin must enter confirmed docks.</p>:['OPERATIONS_SUPERVISOR','FACILITY_MANAGER'].includes(role??'')?<div className="mt-2 flex flex-wrap gap-2"><select aria-label="Available loading dock" className="field" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose an available dock</option>{docks.filter(d=>d.status==='AVAILABLE').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><button className="btn-secondary px-3" disabled={!selected||busy} onClick={()=>void assign()}>Assign this movement</button></div>:<p className="text-sm">Operations or Facility Manager assigns the loading dock.</p>}</section>
}
