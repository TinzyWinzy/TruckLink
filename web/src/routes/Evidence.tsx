import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useLive } from '../lib/liveGate'
import { fingerprint } from '../lib/journey'
import { PageHeader, Section } from '../components/ui'
import VehicleEvidenceDesk from '../components/VehicleEvidenceDesk'
import { canVisit } from '../lib/gates'
import { useSession } from '../store/session'

type Entity = 'vehicle' | 'driver' | 'trip' | 'load'
type RecordRow = { id:number; evidence_key:string; revision:number; kind:string; issuer:string; document_ref:string; document_sha256:string; issued_at:string; expires_at:string; creator:number; review_status:string; entity_type:Entity; entity_label:string; vehicle:number|null; driver:number|null; trip:number|null; load:number|null }
type Workspace = { records:RecordRow[]; total:number; limit:number; scope:string; as_of:string; can_create:boolean; choices:Record<Entity,{id:number;label:string}[]>; choices_limit:number }
const blank = { evidence_key:'', revision:'1', kind:'', issuer:'', document_ref:'', document_sha256:'', issued_at:'', expires_at:'' }
const human = (value:string) => value.replaceAll('_',' ').toLowerCase()
export default function Evidence(){
  const live=useLive();const role=useSession(s=>s.role);const [data,setData]=useState<Workspace|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('')
  const [query,setQuery]=useState('');const [filter,setFilter]=useState('all');const [search,setSearch]=useState('');const [revision,setRevision]=useState(0)
  const [entity,setEntity]=useState<Entity>('vehicle');const [entityId,setEntityId]=useState('');const [doc,setDoc]=useState(blank)
  const [busy,setBusy]=useState(false);const [hashing,setHashing]=useState(false);const [formOpen,setFormOpen]=useState(false);const fileGeneration=useRef(0)
  const fileInput=useRef<HTMLInputElement>(null)
  // eslint-disable-next-line react/set-state-in-effect -- Invalidate previous search results while the new request is pending.
  useEffect(()=>{if(!live)return;let active=true;setError('');setData(null)
    apiFetch<Workspace>(`/regulatory/evidence-workspace/?q=${encodeURIComponent(search)}`).then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError((e as Error).message)})
    return()=>{active=false}
  },[live,search,revision])
  const now=data?new Date(data.as_of).getTime():0
  const expired=(row:RecordRow)=>new Date(row.expires_at).getTime()<=now
  const current=(row:RecordRow)=>!expired(row)&&new Date(row.issued_at).getTime()<=now
  const rows=data?.records.filter(row=>filter==='all'||filter==='expired'&&expired(row)||filter==='pending'&&row.review_status!=='REVIEWED'||filter==='current'&&current(row)&&row.review_status==='REVIEWED')??[]
  function renew(row:RecordRow){setEntity(row.entity_type);setEntityId(String(row[row.entity_type]));setDoc({...blank,evidence_key:row.evidence_key,revision:String(Math.max(row.revision,...(data?.records.filter(r=>r.evidence_key===row.evidence_key).map(r=>r.revision)??[]))+1),kind:row.kind,issuer:row.issuer});setFormOpen(true);setNotice('Record the new document and dates. Earlier revisions and reviews remain retained.');fileGeneration.current++;setHashing(false);if(fileInput.current)fileInput.current.value=''}
  async function save(event:React.FormEvent){event.preventDefault();setError('');setNotice('');setBusy(true)
    try { if(new Date(doc.expires_at)<=new Date(doc.issued_at))throw new Error('Expiry must follow issue time.')
      await apiFetch('/regulatory/evidence/',{method:'POST',body:{...doc,revision:Number(doc.revision),[entity]:Number(entityId),issued_at:new Date(doc.issued_at).toISOString(),expires_at:new Date(doc.expires_at).toISOString()}})
      setDoc(blank);setFormOpen(false);if(fileInput.current)fileInput.current.value='';setNotice('Evidence revision recorded. A different authorised person must review it in Pending approvals.');setRevision(n=>n+1)
    } catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className="space-y-5"><PageHeader title="Evidence" sub="Find retained documents, check expiry and record a new revision." mode={live?'live':'demo'}/>
    {!live?<Section title="Connected evidence workspace"><p>Sign in to a connected tenant to inspect or record evidence.</p></Section>:<>
    <div className="flex flex-wrap items-end gap-3"><form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setSearch(query)}}><label className="text-sm">Search document, vehicle, driver or destination<input className="field mt-1 block w-full" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="btn-primary min-h-12 px-4">Search</button></form>
    <label className="text-sm">Show<select className="field mt-1 block" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All loaded revisions</option><option value="pending">Not independently approved</option><option value="expired">Expired</option><option value="current">Reviewed and in date</option></select></label><button className="report-text-link" onClick={()=>setRevision(n=>n+1)}>Refresh evidence</button>{canVisit('approvals',role)&&<Link className="report-text-link" to="/approvals">Pending approvals</Link>}</div>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={()=>setRevision(n=>n+1)}>Retry</button></p>}{notice&&<p role="status" className="rounded-xl bg-slate-100 p-4 text-sm">{notice}</p>}
    {!data&&!error?<p role="status">Loading evidence…</p>:data&&<>
      <p className="text-sm text-slate-600">{data.scope} Showing {rows.length} of {data.records.length} loaded revisions ({data.total} matching). Read {new Date(data.as_of).toLocaleString()}. Search to narrow results beyond {data.limit}.</p>
      {data.can_create?<Section title="Record evidence"><button className="report-text-link" aria-expanded={formOpen} onClick={()=>setFormOpen(v=>!v)}>{formOpen?'Close document form':'Record a document revision'}</button>
      {formOpen&&<form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={save}>
        <label className="text-sm">Record belongs to<select className="field mt-1 block w-full" value={entity} onChange={e=>{setEntity(e.target.value as Entity);setEntityId('')}}>{(['vehicle','driver','trip','load'] as Entity[]).map(key=><option key={key} value={key}>{key}</option>)}</select></label>
        <label className="text-sm">Existing {entity}<select className="field mt-1 block w-full" required value={entityId} onChange={e=>setEntityId(e.target.value)}><option value="">Choose {entity}</option>{data.choices[entity].map(item=><option key={item.id} value={item.id}>{item.label}</option>)}{entityId&&!data.choices[entity].some(item=>String(item.id)===entityId)&&<option value={entityId}>Retained {entity} {entityId}</option>}</select></label>
        {Object.entries({evidence_key:'Document identity / reference key',revision:'Revision',kind:'Evidence type (tenant requirement code)',issuer:'Issuer',document_ref:'Retained document location',issued_at:'Issued at (local time)',expires_at:'Expires at (local time)'}).map(([key,label])=><label key={key} className="min-w-0 text-sm">{label}<input className="field mt-1 block w-full" required maxLength={key==='evidence_key'?100:key==='kind'?64:key==='document_ref'?500:key==='issuer'?200:undefined} min={key==='revision'?1:undefined} step={key==='revision'?1:undefined} type={key.endsWith('_at')?'datetime-local':key==='revision'?'number':'text'} value={doc[key as keyof typeof doc]} onChange={e=>setDoc(old=>({...old,[key]:e.target.value}))}/></label>)}
        <label className="min-w-0 text-sm">Source document fingerprint<input ref={fileInput} className="mt-2 block w-full" type="file" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];const generation=++fileGeneration.current;setDoc(old=>({...old,document_sha256:''}));if(!file){setHashing(false);return}setHashing(true);try{const sha=await fingerprint(file);if(generation===fileGeneration.current)setDoc(old=>({...old,document_sha256:sha}))}catch{if(generation===fileGeneration.current)setError('Could not fingerprint document. Select it again.')}finally{if(generation===fileGeneration.current)setHashing(false)}}}/><span className="mt-2 block">{hashing?'Reading document…':doc.document_sha256?'Fingerprint ready.':'Select the retained source document.'} The file stays on this device; its fingerprint does not verify authenticity.</span></label>
        <p className="text-sm md:col-span-2">Choices show the latest {data.choices_limit} tenant records. Evidence type must match the requirement used in inspection setup. A document or review does not authorise release.</p>
        <button className="btn-primary min-h-12 px-4 md:col-span-2" disabled={busy||hashing||!doc.document_sha256||!entityId}>{busy?'Recording…':'Record evidence revision'}</button>
      </form>}</Section>:<p className="text-sm">Read-only evidence access. An authorised compliance reviewer records new revisions.</p>}
      <Section title="Document register">{rows.length===0?<p>No evidence matches this search and filter.</p>:<ul className="space-y-4">{rows.map(row=><li key={row.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 break-words"><h3 className="font-bold">{row.evidence_key} · revision {row.revision}</h3><p className="mt-1 text-sm">{row.entity_label} · {human(row.kind)}</p></div><span className={`rounded-lg px-3 py-2 text-sm font-bold ${expired(row)?'bg-red-50 text-red-800':row.review_status==='REVIEWED'?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900'}`}>{expired(row)?'Expired':!current(row)?'Not yet in date':human(row.review_status)}</span></div><p className="mt-2 text-sm">Expires {new Date(row.expires_at).toLocaleString()} · Review: {human(row.review_status)}</p><details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Document details</summary><dl className="space-y-2 break-words"><dt>Issuer</dt><dd>{row.issuer}</dd><dt>Retained location</dt><dd>{row.document_ref}</dd><dt>SHA-256</dt><dd className="break-all">{row.document_sha256}</dd><dt>Issued</dt><dd>{new Date(row.issued_at).toLocaleString()}</dd><dt>Recorded by</dt><dd>Staff {row.creator}</dd></dl></details>{data.can_create&&<button className="report-text-link" onClick={()=>renew(row)}>Record renewal revision</button>}</li>)}</ul>}</Section>
      {data.can_create&&<VehicleEvidenceDesk/>}
    </>}
    </>}
  </div>
}
