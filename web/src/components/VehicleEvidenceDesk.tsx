import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { useSession } from '../store/session'
import { Section } from './ui'

type Evidence={id:number;vehicle:number;kind:string;revision:number;evidence_key:string;document_ref:string;creator:number;review_status:string}
type Configuration={id:number;vehicle:number;revision:number;vehicle_class:string;creator:number;review_status:string}
export default function VehicleEvidenceDesk(){
  const {role,userId}=useSession()
  const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('')
  const [vehicles,setVehicles]=useState<{id:number;plate:string}[]>([]);const [evidence,setEvidence]=useState<Evidence[]>([]);const [configs,setConfigs]=useState<Configuration[]>([])
  const [vehicle,setVehicle]=useState('');const [rating,setRating]=useState('');const [reason,setReason]=useState('')
  const [doc,setDoc]=useState({evidence_key:'',revision:'1',issuer:'',document_ref:'',issued_at:'',expires_at:'',document_sha256:''})
  const [config,setConfig]=useState({revision:'1',vehicle_class:'',rated_axle_kg:'',axle_kinds:'',rated_gross_kg:'',effective_from:'',effective_to:''})
  const reviewer=role==='ADMIN'||role==='COMPLIANCE_OFFICER'
  if(!reviewer)return null
  async function load(){
    const results=await Promise.allSettled([apiFetch<{vehicles:{id:number;plate:string}[]}>('/vehicles/'),apiFetch<{records:Evidence[]}>('/regulatory/evidence/'),apiFetch<{records:Configuration[]}>('/regulatory/vehicle-configurations/')])
    const [v,e,c]=results
    if(v.status==='fulfilled')setVehicles(v.value.vehicles)
    if(e.status==='fulfilled')setEvidence(e.value.records)
    if(c.status==='fulfilled')setConfigs(c.value.records)
    const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason
  }
  async function act(fn:()=>Promise<unknown>,success:string){setBusy(true);setError('');setMessage('');try{await fn();await load();setMessage(success)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const field=(key:keyof typeof doc,label:string,type='text')=><label className="text-sm" key={key}>{label}<input className="field mt-1 w-full" type={type} value={doc[key]} onChange={e=>setDoc(old=>({...old,[key]:e.target.value}))}/></label>
  return <Section title="Vehicle evidence and independent review" sub="Record source documents and rated configurations. Creation does not approve a record; a different person must review it.">
    <button className="min-h-12 underline" disabled={busy} onClick={()=>{setOpen(true);void act(async()=>{},'Evidence register loaded.')}}>{open?'Refresh evidence register':'Open evidence register'}</button>
    {error&&<p role="alert" className="my-3 text-sm text-red-800">{error}</p>}{message&&<p role="status" className="my-3 text-sm">{message}</p>}
    {open&&<div className="space-y-5">
      <label className="block text-sm font-bold">Registered vehicle<select className="field mt-1 w-full" value={vehicle} onChange={e=>{setVehicle(e.target.value);setRating('')}}><option value="">Choose existing fleet vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.plate}</option>)}</select></label>
      <details><summary className="cursor-pointer text-sm font-bold">Record vehicle-rating document</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field('evidence_key','Document identity / reference key')}{field('revision','Document revision','number')}{field('issuer','Document issuer')}{field('document_ref','Retained document location')}{field('issued_at','Issued at','datetime-local')}{field('expires_at','Expires at','datetime-local')}
        <label className="min-w-0 text-sm sm:col-span-2">Fingerprint source document<input type="file" className="mt-2 block w-full text-xs" onChange={async e=>{setDoc(old=>({...old,document_sha256:''}));const f=e.target.files?.[0];if(!f)return;try{const hash=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());setDoc(old=>({...old,document_sha256:Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('')}))}catch{setError('Could not fingerprint document. Select it again.')}}}/><p className="mt-2 text-xs">{doc.document_sha256?'Fingerprint recorded. ':''}The file stays on this device. Retain it at the document location; a fingerprint does not verify authenticity.</p></label>
        <button className="btn-primary min-h-12 px-4 sm:col-span-2" disabled={busy||!vehicle||Object.values(doc).some(v=>!v.trim())} onClick={()=>void act(()=>apiFetch('/regulatory/evidence/',{method:'POST',body:{...doc,revision:Number(doc.revision),vehicle:Number(vehicle),kind:'VEHICLE_RATING',issued_at:new Date(doc.issued_at).toISOString(),expires_at:new Date(doc.expires_at).toISOString()}}),'Rating document recorded. A different person must review it.')}>Record rating evidence</button>
      </div></details>
      <details><summary className="cursor-pointer text-sm font-bold">Record rated vehicle configuration</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Rating source<select className="field mt-1 w-full" value={rating} onChange={e=>setRating(e.target.value)}><option value="">Choose this vehicle's rating document</option>{evidence.filter(e=>e.vehicle===Number(vehicle)&&e.kind==='VEHICLE_RATING').map(e=><option key={e.id} value={e.id}>{e.evidence_key} / revision {e.revision} / {e.review_status}</option>)}</select></label>
        {Object.entries({revision:'Configuration revision',vehicle_class:'Vehicle class',rated_axle_kg:'Axle ratings in order (kg, comma separated)',axle_kinds:'Axle types in order (comma separated)',rated_gross_kg:'Rated gross mass (kg)',effective_from:'Effective from',effective_to:'Effective to (optional)'}).map(([key,label])=><label className="text-sm" key={key}>{label}<input className="field mt-1 w-full" type={key.startsWith('effective')?'date':'text'} value={config[key as keyof typeof config]} onChange={e=>setConfig(old=>({...old,[key]:e.target.value}))}/></label>)}
        <button className="btn-primary min-h-12 px-4 sm:col-span-2" disabled={busy||!vehicle||!rating||Object.entries(config).some(([k,v])=>k!=='effective_to'&&!v.trim())} onClick={()=>void act(()=>apiFetch('/regulatory/vehicle-configurations/',{method:'POST',body:{...config,axle_kinds:undefined,revision:Number(config.revision),vehicle:Number(vehicle),rating_evidence:Number(rating),rated_axle_kg:config.rated_axle_kg.split(',').map(x=>x.trim()),axle_layout:config.axle_kinds.split(',').map((kind,i)=>({position:i+1,kind:kind.trim()})),effective_to:config.effective_to||null}}),'Configuration recorded. A different person must review it.')}>Record vehicle configuration</button>
      </div></details>
      <div className="border-t pt-4"><h3 className="font-bold">Independent review</h3><label className="mt-3 block text-sm">Review reason<input className="field mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <ul className="mt-3 space-y-4">{[...evidence.filter(e=>e.kind==='VEHICLE_RATING'&&(!vehicle||e.vehicle===Number(vehicle))).map(e=>({...e,subject:'evidence',label:e.document_ref})),...configs.filter(c=>!vehicle||c.vehicle===Number(vehicle)).map(c=>({...c,subject:'configuration',label:`${c.vehicle_class} configuration`}))].map(r=><li key={`${r.subject}:${r.id}`} className="break-words border-l-2 border-slate-300 pl-3 text-sm"><p>{r.label} / revision {r.revision} / {r.review_status}</p><p>Recorded by staff {r.creator}{r.creator===Number(userId)?' / another person must review your record':''}</p><div className="mt-2 flex flex-wrap gap-2">{[true,false].map(approved=><button key={String(approved)} className="min-h-12 rounded border px-3" disabled={busy||!reason.trim()||r.creator===Number(userId)} onClick={()=>void act(()=>apiFetch('/regulatory/reviews/',{method:'POST',body:{subject:r.subject,subject_id:r.id,approved,reason}}),'Review recorded. Inspection setup will recheck current evidence.')}>{approved?'Approve record':'Reject / revoke record'}</button>)}</div></li>)}</ul>
      </div>
    </div>}
  </Section>
}
