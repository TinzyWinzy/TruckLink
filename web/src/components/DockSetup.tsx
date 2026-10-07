import {useEffect,useState} from 'react'
import {apiFetch,facilityId} from '../lib/api'
import {Section} from './ui'

type Dock={id:number;name:string;status:string;capacity_kg:number}
export default function DockSetup(){
  const [docks,setDocks]=useState<Dock[]>([]);const [name,setName]=useState('');const [capacity,setCapacity]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [loaded,setLoaded]=useState(false)
  async function load(){const d=await apiFetch<{docks:Dock[]}>(`/docks/?facility=${encodeURIComponent(facilityId)}`);setDocks(d.docks);setLoaded(true)}
  useEffect(()=>{let active=true;apiFetch<{docks:Dock[]}>(`/docks/?facility=${encodeURIComponent(facilityId)}`).then(d=>{if(active){setDocks(d.docks);setLoaded(true)}}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[])
  async function create(){setBusy(true);setMessage('');try{await apiFetch('/docks/',{method:'POST',body:{facility:facilityId,name:name.trim(),...(capacity?{capacity_kg:Number(capacity)}:{})}});setName('');setCapacity('');await load();setMessage('Dock created for the selected site.')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
  return <Section title="Site docks" sub="Enter confirmed operational docks. Leave capacity blank when it is unknown; no site dimensions are assumed."><div className="space-y-3">
    {!loaded?<p role="status">{message||'Loading configured docks…'}</p>:<ul className="text-sm">{docks.map(d=><li key={d.id}>{d.name} · {d.status} · {d.capacity_kg?`${d.capacity_kg} kg`:'Capacity not recorded'}</li>)}{!docks.length&&<li>No docks configured for this site.</li>}</ul>}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void create()}}><label className="text-sm">Confirmed dock name<input required className="field mt-1 w-full px-3" value={name} onChange={e=>setName(e.target.value)}/></label><label className="text-sm">Capacity (kg), optional<input type="number" min="0" className="field mt-1 w-full px-3" value={capacity} onChange={e=>setCapacity(e.target.value)}/></label><button className="btn-primary px-3" disabled={busy||!name.trim()}>Add site dock</button><button type="button" className="btn-secondary px-3" onClick={()=>void load().catch(e=>setMessage(e.message))}>Refresh docks</button></form>{message&&loaded&&<p role="status">{message}</p>}
  </div></Section>
}
