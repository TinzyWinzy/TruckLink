import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { isPracticeSession, useSession } from '../store/session'
import { canVisit, type RouteKey } from '../lib/gates'
import { PageHeader } from '../components/ui'

type WorkspaceData={organisation:{id:number;name:string};facility:{id:number;name:string};role:string;as_of:string;activation_required:boolean;notice:string;cards:{key:string;module:string;title:string;description:string;href:string}[]}
export default function Workspace(){
  const {workspace,role,userId}=useSession(),facility=workspace?.selectedFacility??'',practice=isPracticeSession(userId)
  const [data,setData]=useState<WorkspaceData|null>(null),[requestError,setError]=useState(''),[reload,setReload]=useState(0)
  const error=requestError||(!practice&&!facility?'Select an assigned workspace.':'')
  useEffect(()=>{let active=true;if(practice||!facility)return;void apiFetch<WorkspaceData>(`/tenant/workspace/?facility=${encodeURIComponent(facility)}`).then(value=>{if(active){if(value.facility.id!==Number(facility)||value.organisation.id!==workspace?.organisation?.id||value.role!==role)throw new Error('Workspace scope changed. Reload your session.');setData(value)}}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[facility,workspace?.organisation?.id,role,reload,practice])
  return <div className="space-y-6"><PageHeader title="Your workspace" sub="Capabilities configured for your company, role and assigned site."/>
    {practice&&<p className="card p-5">Practice mode uses synthetic scenarios. Tenant subscriptions apply to signed-in company workspaces. <Link className="report-text-link" to="/guide">Open the walkthrough guide</Link></p>}
    {!practice&&!data&&!error&&<p role="status">Loading your workspace…</p>}
    {error&&<div className="card p-5" role="alert"><p>{error}</p><button className="btn-secondary mt-3 px-4" onClick={()=>{setError('');setData(null);setReload(n=>n+1)}}>Retry workspace</button></div>}
    {data&&<><p className="text-sm font-semibold">{data.organisation.name} / {data.facility.name} · {data.role.replaceAll('_',' ')}</p>
      {data.activation_required&&<p className="card p-5">Operational activation is pending discovery and review. {role==='ADMIN'&&<Link className="report-text-link" to="/onboarding">Continue onboarding</Link>}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.cards.filter(card=>canVisit(card.href.slice(1) as RouteKey,role)).map(card=><Link key={card.key} className="card block p-5 hover:border-blue-400 focus-visible:outline-2" to={card.href}><h2 className="text-lg font-bold">{card.title}</h2><p className="mt-2 text-sm text-slate-600">{card.description}</p><span className="report-text-link mt-4 inline-block">Open →</span></Link>)}</div>
      {!data.cards.length&&<p className="card p-5">No operational modules are available for this role and site. Ask the tenant administrator to review access.</p>}
      <p className="text-sm text-slate-600">{data.notice}</p>
    </>}
  </div>
}
