import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {apiFetch,facilityId} from '../lib/api'
import {useLive} from '../lib/liveGate'
import {PageHeader,Section} from '../components/ui'

type Review={id:number;subject:string;label:string;creator_id:number;created_at:string;can_review:boolean;expired:boolean;last_review:string;document_ref:string;document_sha256:string}
type Exception={id:number;entry_id:number;plate:string;attempt_id:number;reason:string;creator_id:number;can_review:boolean}
type Pending={as_of:string;evidence_reviews:Review[];expired:Review[];exceptions:Exception[];scope:string}
export default function PendingApprovals(){
  const live=useLive();const [data,setData]=useState<Pending|null>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0)
  const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('')
  useEffect(()=>{if(!live)return;let active=true;apiFetch<Pending>(`/pending-approvals/?facility=${encodeURIComponent(facilityId)}`).then(d=>{if(active){setData(d);setError('')}}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[live,version])
  async function decide(item:Review|Exception,approved:boolean){
    setBusy(true);setError('');setNotice('')
    try{await apiFetch('subject' in item?'/regulatory/reviews/':`/regulatory/override-requests/${item.id}/approve/`,{method:'POST',body:{...('subject' in item?{subject:item.subject,subject_id:item.id}:{}),approved,reason}});setReason('');setNotice('Decision retained. Existing inspection history is unchanged.');setVersion(n=>n+1)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className="max-w-4xl space-y-4"><PageHeader title="Pending approvals" sub="Independent evidence review and site-specific operational exceptions have different permissions." mode={live?'live':'demo'}/>
    {!live?<Section title="Practice review boundary"><p className="text-sm">Use separate authorised accounts in an isolated training workspace to test independent approval. Local practice does not record regulatory reviews.</p><Link className="report-text-link" to="/guide">Review the workflow guide</Link></Section>:<>
      <div className="flex flex-wrap gap-3"><button className="report-text-link" onClick={()=>setVersion(n=>n+1)}>Refresh pending reviews</button>{data&&<p className="text-xs">Read {new Date(data.as_of).toLocaleString()} · {data.scope}</p>}</div>
      {error&&<p role="alert">{error} <button className="underline" onClick={()=>setVersion(n=>n+1)}>Retry</button></p>}{!data&&!error&&<p role="status">Loading pending reviews…</p>}{notice&&<p role="status">{notice}</p>}
      {data&&<><label className="block text-sm font-bold">Decision reason<textarea className="field mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <Section title={`Evidence and configuration reviews (${data.evidence_reviews.length})`} sub="Tenant-owned records. The author cannot approve their own evidence.">
          {!data.evidence_reviews.length&&<p className="text-sm">No unapproved records in the loaded review window.</p>}
          <ul className="space-y-3">{data.evidence_reviews.map(r=><li key={`${r.subject}:${r.id}`} className="border-l-2 border-slate-300 pl-3 text-sm"><strong>{r.label}</strong><p>{r.subject} {r.id} / {r.last_review} / Author {r.creator_id}</p><details className="mt-2"><summary className="cursor-pointer">Retained document reference</summary><p className="break-words">{r.document_ref}</p><p className="break-all text-xs">SHA-256: {r.document_sha256}</p><p>Review the original document at its retained location. This fingerprint does not establish authenticity.</p></details>{r.can_review?<div className="mt-2 flex gap-2"><button className="btn-primary px-3" disabled={busy||!reason.trim()} onClick={()=>void decide(r,true)}>Approve {r.subject} {r.id}</button><button className="rounded border px-3" disabled={busy||!reason.trim()} onClick={()=>void decide(r,false)}>Reject {r.subject} {r.id}</button></div>:<p className="mt-2">A different authorised evidence reviewer must decide this record.</p>}</li>)}</ul>
        </Section>
        <Section title={`Operational exceptions (${data.exceptions.length})`} sub="Operations or Admin independently reviews eligible exceptions. Compliance inspection access does not grant this authority.">
          {!data.exceptions.length&&<p className="text-sm">No current operational exception requests.</p>}
          <ul className="space-y-3">{data.exceptions.map(r=><li key={r.id} className="border-l-2 pl-3 text-sm"><strong>{r.plate} / Inspection {r.attempt_id}</strong><p>{r.reason}</p><Link className="report-text-link mt-2" to={`/compliance?entry=${r.entry_id}`}>Read inspection</Link>{r.can_review?<div className="mt-2 flex gap-2"><button className="btn-primary px-3" disabled={busy||!reason.trim()} onClick={()=>void decide(r,true)}>Approve exception {r.id}</button><button className="rounded border px-3" disabled={busy||!reason.trim()} onClick={()=>void decide(r,false)}>Reject exception {r.id}</button></div>:<p className="mt-2">A separate authorised operations reviewer is required.</p>}</li>)}</ul>
        </Section>
        <Section title={`Expired evidence and configurations (${data.expired.length})`} sub="Expiry requires a valid new revision and review; an approval click does not extend validity."><ul className="space-y-2 text-sm">{data.expired.map(r=><li key={`${r.subject}:${r.id}`}>{r.label} / {r.subject} {r.id}</li>)}</ul></Section>
      </>}
    </>}
  </div>
}
