import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {useLive} from '../lib/liveGate'
import {apiFetch} from '../lib/api'
import {canVisit} from '../lib/gates'
import {tenantDisplayName} from '../lib/tenant'
import {WALKTHROUGH_ROLES,WALKTHROUGH_TASKS} from '../lib/walkthrough'
import {PageHeader,Section} from '../components/ui'
import {useSession,type Role} from '../store/session'

type Readiness={counts:Record<string,number>;visits:{id:number;plate:string;status:string}[];integrations:{erp:string;tracker:string};notice:string}
export default function Guide() {
  const {workspace,userId,role}=useSession()
  const live=useLive()
  const key=['trucki-walkthrough-v3',workspace?.organisation?.id??'practice',userId,workspace?.selectedFacility].join(':')
  const [done,setDone]=useState<Record<string,boolean>>(()=>{try{const d=JSON.parse(localStorage.getItem(key)??'{}');return d&&typeof d==='object'&&!Array.isArray(d)?d:{}}catch{return {}}})
  const [filter,setFilter]=useState<Role|'ALL'>('ALL')
  const [readiness,setReadiness]=useState<Readiness|null>(null)
  const [error,setError]=useState('')
  const [reload,setReload]=useState(0)
  const [visit,setVisit]=useState('')
  useEffect(()=>{
    if(!live||!workspace?.selectedFacility)return
    let cancelled=false
    apiFetch<Readiness>(`/walkthrough/?facility=${encodeURIComponent(workspace.selectedFacility)}`).then(data=>{if(!cancelled){setReadiness(data);setError('')}}).catch(e=>{if(!cancelled){setReadiness(null);setError((e as Error).message)}})
    return ()=>{cancelled=true}
  },[live,workspace?.selectedFacility,reload])
  const tasks=WALKTHROUGH_TASKS.filter(t=>filter==='ALL'||t.roles.includes(filter))
  const finished=tasks.filter(t=>done[t.id]).length
  function toggle(id:string){setDone(old=>{const next={...old,[id]:!old[id]};try{localStorage.setItem(key,JSON.stringify(next))}catch{/* Optional learning progress. */}return next})}
  const label=(r:Role)=>workspace?.configuration?.content.roles[r]?.label??r.replaceAll('_',' ')
  return <div className="max-w-4xl space-y-4">
    <PageHeader title="Operational walkthrough" sub="Follow a customer consignment and its trucks from setup through release, delivery and exceptions. Each step names its owner and expected result." mode={live?'live':'demo'}/>
    {canVisit('consignments',role)&&<Link className="report-text-link inline-flex min-h-11 items-center" to="/consignments">Customer consignments and fulfilment →</Link>}
    <Section title={live?`${tenantDisplayName(workspace?.configuration,workspace?.organisation?.name)} review`:'Platform practice review'} sub={live?'You are viewing your assigned tenant and site. Operational actions affect live records.':'Practice uses synthetic local data. It does not write tenant records or demonstrate a connected ERP or tracker.'}>
      <p className="text-sm">Authorised tenant reviewers use individual staff accounts. External reviewers can explore the platform in practice; access to a company's operational records requires that company's authorisation.</p>
      <p className="mt-2 text-sm">Use the working-role selector if you are an Admin. Other staff stay within their assigned role. Independent approvals require a different person.</p>
      <div className="mt-3 flex flex-wrap gap-3">{canVisit('evidence',role)&&<Link className="report-text-link" to="/evidence">Evidence and renewals</Link>}{canVisit('deliveries',role)&&<Link className="report-text-link" to="/deliveries">Deliveries and exceptions</Link>}{canVisit('recovery',role)&&<Link className="report-text-link" to="/recovery">Device recovery desk</Link>}</div>
      {!live&&<p className="mt-2 text-sm">Explore screens in the navigation, then return here. Full return and recovery commands require an authorised live journey; this guide explains their prerequisites.</p>}
    </Section>
    {live&&<Section title="Current site readiness" sub="Read-only inventory. Counts do not certify a truck or authorise release.">
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {!readiness&&!error&&<p role="status">Loading assigned-site readiness.</p>}
      {readiness&&<><dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(readiness.counts).map(([k,v])=><div className="card p-3" key={k}><dt className="text-xs uppercase text-slate-600">{k.replaceAll('_',' ')}</dt><dd className="text-2xl font-bold">{v}</dd></div>)}</dl>
        <p className="mt-3 text-sm">{readiness.notice}</p>
        <p className="mt-2 text-sm">ERP: {readiness.integrations.erp.replaceAll('_',' ')} · Tracker: {readiness.integrations.tracker.replaceAll('_',' ')}</p>
        {canVisit('compliance',role)&&<div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">Inspect an existing visit<select className="field mt-1 block w-full" value={visit} onChange={e=>setVisit(e.target.value)}><option value="">Choose a visit</option>{readiness.visits.map(v=><option key={v.id} value={v.id}>{v.plate} / Visit {v.id} / {v.status}</option>)}</select></label>{visit&&<Link className="btn-primary px-4" to={`/compliance?entry=${encodeURIComponent(visit)}`}>Open visit inspection</Link>}</div>}
      </>}
      <button className="report-text-link mt-3" onClick={()=>{setError('');setReadiness(null);setReload(n=>n+1)}}>Refresh readiness</button>
    </Section>}
    <Section title="People and responsibilities" sub="All six current staff types; drivers and receivers are recorded participants, not authenticated portal users.">
      <ul className="grid gap-3 sm:grid-cols-2">{WALKTHROUGH_ROLES.map(r=><li className="card p-3 text-sm" key={r.role}><strong>{label(r.role)}</strong><p className="mt-1">{r.purpose}</p></li>)}</ul>
    </Section>
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm font-bold">Show responsibility<select className="field ml-2" value={filter} onChange={e=>setFilter(e.target.value as Role|'ALL')}><option value="ALL">All roles</option>{WALKTHROUGH_ROLES.map(r=><option key={r.role} value={r.role}>{label(r.role)}</option>)}</select></label><p className="text-sm" role="status">{finished}/{tasks.length} steps reviewed</p></div>
    <p className="text-xs text-slate-600">Review ticks save on this device for your account and site. They do not execute operations, certify training or grant release.</p>
    {tasks.map((t,index)=><Section key={t.id} step={String(index+1)} title={t.title} sub={`Owner: ${t.roles.map(label).join(' / ')}`}>
      <p className="text-sm"><strong>Before you start:</strong> {t.before}</p><p className="mt-2 text-sm">{t.action}</p><p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm"><strong>Expected result:</strong> {t.expect}</p>
      <div className="mt-3 flex flex-wrap gap-2">{canVisit(t.route,role)?<Link to={`/${t.route}`} className="btn-primary px-4">Open {t.route}</Link>:<p className="self-center text-sm text-slate-600">Ask the responsible role to demonstrate this step. Your current role cannot open this screen.</p>}<button className="touch-target rounded-lg border px-4 text-sm font-bold" aria-pressed={!!done[t.id]} onClick={()=>toggle(t.id)}>{done[t.id]?'Reviewed':'Mark reviewed'}</button></div>
    </Section>)}
    <Section title="ERP and tracker discovery" sub="Integration adapters remain unconfigured."><p className="text-sm">Confirm vendor names, system owners, sandbox access, stable vehicle/trip/order identifiers, event timing and permitted data flows. Agree which system owns dispatch, positions, delivery evidence and financial closure before connecting it. Do not share API secrets in walkthrough notes.</p></Section>
  </div>
}
