import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useSession } from '../store/session'
import { apiFetch } from '../lib/api'
import { tenantDisplayName } from '../lib/tenant'
import { readSubscription, type Subscription } from '../lib/subscriptions'
import { PageHeader, Section } from '../components/ui'
import ModuleSelection from '../components/ModuleSelection'
import TenantSettings from '../components/TenantSettings'
import PlatformConfiguration from '../components/PlatformConfiguration'
import StaffProvisioning from '../components/StaffProvisioning'
import DockSetup from '../components/DockSetup'

interface Site {id:number;name:string;slug:string;timezone:string;placeholder:boolean}
const steps=['Company and sites','Capabilities','Operating procedures','Independent review','Activation']
export default function Onboarding() {
  const {workspace,role}=useSession()
  const [params,setParams]=useSearchParams()
  const requested=Number(params.get('step')??(role==='COMPLIANCE_OFFICER'?4:1))
  const step=Number.isInteger(requested)&&requested>=1&&requested<=5?requested:1
  const [revisions,setRevisions]=useState<{kind:string;review_approved?:boolean|null}[]>([])
  const [sites,setSites]=useState<Site[]>([]),[subscription,setSubscription]=useState<Subscription|null>(null)
  const [error,setError]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false)
  const [name,setName]=useState(''),[timezone,setTimezone]=useState('Africa/Harare')
  const refresh=useCallback(async()=>{
    const org=useSession.getState().workspace?.organisation?.id
    try {const [result,modules,versions]=await Promise.all([apiFetch<{sites:Site[]}>('/tenant/sites/'),useSession.getState().role==='ADMIN'?readSubscription():Promise.resolve(null),apiFetch<{revisions:{kind:string;review_approved?:boolean|null}[]}>('/tenant/revisions/')]);if(useSession.getState().workspace?.organisation?.id!==org)return;setSites(result.sites);setSubscription(modules);setRevisions(versions.revisions);setLoaded(true);setError('')}
    catch(e){setError((e as Error).message)}
  },[])
  useEffect(()=>{void Promise.resolve().then(refresh)},[refresh,step])
  async function createSite(){const org=useSession.getState().workspace?.organisation?.id;setBusy(true);setError('');try{
    const {site}=await apiFetch<{site:Site}>('/tenant/sites/',{method:'POST',body:{name,timezone}})
    const current=useSession.getState().workspace
    if(current?.organisation?.id!==org)return
    if(current)useSession.getState().setWorkspace({...current,facilities:[...current.facilities,site],selectedFacility:String(site.id)})
    setName('');await refresh()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const release=workspace?.configuration?.release
  const companySaved=!!workspace?.configuration?.id&&sites.some(s=>!s.placeholder)
  const capabilitySaved=!!subscription?.selection
  const blocked=subscription?.selection?.required_modules.filter(m=>!subscription.entitlement.modules.includes(m))??[]
  const statuses=[companySaved?'Saved':'Needs setup',capabilitySaved?'Request saved':'Needs selection',revisions.length?'Drafts saved':'Save procedures',revisions.some(r=>['WORKFLOW','POLICY'].includes(r.kind)&&r.review_approved)?'Approval recorded':'Different reviewer required',release?'Active':'Awaiting activation']
  const go=(value:number)=>setParams({step:String(value)})
  return <div className="max-w-4xl space-y-6">
    <PageHeader title="Client onboarding" sub={`${tenantDisplayName(workspace?.configuration,workspace?.organisation?.name)} · Set up your operation, one step at a time.`}/>
    <section className="card p-5" aria-label="Activation status"><h2 className="text-xl font-bold">{release?'Operational configuration active':'Setup in progress — operations are locked'}</h2><p className="mt-2">{release?`Active release ${release.version}.`:'Save company details and a real site, choose capabilities, then independently review and activate your procedures.'}</p><p className="mt-2 text-sm">Progress comes from saved company records. Advancing a step does not mark it complete.</p></section>
    <nav aria-label="Setup steps"><ol className="grid gap-2 sm:grid-cols-5">{steps.map((label,index)=><li key={label}><button className={`w-full rounded-lg border p-3 text-left ${step===index+1?'border-blue-500 bg-blue-50':'border-slate-200'}`} aria-current={step===index+1?'step':undefined} onClick={()=>go(index+1)}><strong className="block text-sm">{index+1}. {label}</strong><span className="mt-1 block text-xs">{statuses[index]}</span></button></li>)}</ol></nav>
    {error&&<div role="alert" className="card p-4">{error}<button className="btn-secondary ml-3 px-3" onClick={()=>void refresh()}>Retry loading setup</button></div>}
    {!loaded&&!error&&<p role="status">Loading saved setup…</p>}
    {role!=='ADMIN'&&<p className="card p-4">Company administrators own setup. Independent reviews require an authorized administrator or compliance officer using a different account.</p>}
    {step===1&&<><Section title="Confirm operational sites" sub="Owner: company administrator. The onboarding workspace is an administrative placeholder.">
      {sites.map(site=><p key={site.id} className="mb-2 text-sm"><strong>{site.name}</strong> · {site.timezone} · {site.placeholder?'Administrative placeholder':'Operational site saved'}</p>)}
      {role==='ADMIN'&&<form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();void createSite()}}><label className="block text-sm">Site name<input required maxLength={200} className="field mt-1 w-full px-3" value={name} onChange={e=>setName(e.target.value)}/></label><label className="block text-sm">Site timezone<input required className="field mt-1 w-full px-3" value={timezone} onChange={e=>setTimezone(e.target.value)}/></label><button className="btn-primary px-4" disabled={busy}>{busy?'Creating site…':'Create operational site'}</button><p className="text-sm">The new site is assigned to your account. Operations still require an activated release.</p></form>}
    </Section>{role==='ADMIN'&&<><TenantSettings guided/>{sites.some(s=>String(s.id)===workspace?.selectedFacility&&!s.placeholder)&&<details className="card p-4"><summary>Configure docks for the selected operational site</summary><DockSetup/></details>}</>}</>}
    {step===2&&role==='ADMIN'&&<><ModuleSelection onSaved={()=>void refresh()}/>{capabilitySaved&&<p role="status">Request saved. Continue to operating procedures.{blocked.length?` Platform operator approval needed: ${blocked.join(', ')}.`:''}</p>}</>}
    {step===3&&<><Section title="Define your operating procedures" sub="Owner: company administrator."><p>Save capabilities matching your request, site settings, and a workflow. Confirm inspection checks, escalation owners and timing before review.</p>{!companySaved&&<p className="mt-3">Prerequisite: save company configuration and a real site in step 1.</p>}{!capabilitySaved&&<p className="mt-3">Prerequisite: save a capability request in step 2.</p>}</Section>{role==='ADMIN'&&<PlatformConfiguration stage="configure"/>}</>}
    {step===4&&<><Section title="Hand procedures to an independent reviewer" sub="Owner: a different authorized administrator or compliance officer."><p>The author cannot approve their own workflow or policy, even after switching working roles. Ask the reviewer to sign in with their own account.</p><p className="mt-3">Review handoff: <code>/onboarding?step=4</code>. No notification is sent automatically.</p></Section><PlatformConfiguration stage="review"/>{role==='ADMIN'&&<details className="card p-4"><summary>Provision a reviewer account</summary><StaffProvisioning/></details>}</>}
    {step===5&&<><Section title="Publish and activate reviewed procedures" sub="Owner: company administrator."><p>Select exact saved revisions, publish a release, then activate it. Publication checks independent approvals, capability permissions and workflow dependencies.</p>{blocked.length>0&&<p className="mt-3">Blocked: ask the platform operator to approve {blocked.join(', ')}.</p>}{release&&<Link className="btn-primary mt-4 inline-flex px-4" to="/">Open operations workspace</Link>}</Section>{role==='ADMIN'&&<PlatformConfiguration stage="activate"/>}</>}
    <div className="flex justify-between gap-3"><button className="btn-secondary px-4" disabled={step===1} onClick={()=>go(step-1)}>Previous step</button>{step<5&&<button className="btn-primary px-4" onClick={()=>go(step+1)}>Continue to {steps[step]}</button>}</div>
    <details className="card p-4"><summary>Privacy and discovery responsibilities</summary><p className="mt-3 text-sm">Confirm company authority, providers, movement handoffs, data purpose, access, retention and processing arrangements before importing records. Use individual accounts and collect only required identifiers. Setup does not establish legal compliance.</p><Link className="mt-3 inline-block underline" to="/audit">View company audit history</Link></details>
  </div>
}
