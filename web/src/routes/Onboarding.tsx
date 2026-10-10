import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useSession } from '../store/session'
import { apiFetch, selectFacility } from '../lib/api'
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
    if(current){
      selectFacility(String(site.id))
      try{localStorage.setItem(`trucki-yard-${useSession.getState().userId}`,String(site.id))}catch{ /* Storage unavailable. */ }
      useSession.getState().setWorkspace({...current,facilities:[...current.facilities,site],selectedFacility:String(site.id)})
    }
    setName('');await refresh()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const release=workspace?.configuration?.release
  const companySaved=!!workspace?.configuration?.id&&sites.some(s=>!s.placeholder)
  const capabilitySaved=!!subscription?.selection
  const blocked=subscription?.selection?.required_modules.filter(m=>!subscription.entitlement.modules.includes(m))??[]
  const workflowSaved=revisions.some(r=>r.kind==='WORKFLOW')
  const reviewable=revisions.filter(r=>['WORKFLOW','POLICY'].includes(r.kind))
  const reviewComplete=reviewable.length>0&&reviewable.every(r=>r.review_approved===true)
  const statuses=[companySaved?'Complete':'Needs setup',capabilitySaved?'Request saved':'Needs selection',workflowSaved?'Workflow saved':'Needs workflow',reviewComplete?'Approved':'Review needed',release?'Active':'Not active']
  const nextAction=role==='COMPLIANCE_OFFICER'
    ? !reviewable.length
      ? {step:3,title:'Waiting for procedures',description:'Ask the company administrator to save a workflow or policy. You can review it here once it is ready.'}
      : !reviewComplete
        ? {step:4,title:'Review procedures',description:'Open the saved workflow or policy and record an independent decision.'}
        : {step:5,title:'Review complete',description:'The company administrator can now publish and activate the approved configuration.'}
    : !companySaved
      ? {step:1,title:'Set up your company and site',description:'Save company details and create at least one real operational site.'}
      : !capabilitySaved
        ? {step:2,title:'Choose your capabilities',description:'Select the capabilities your operation needs and save the request.'}
        : !workflowSaved
          ? {step:3,title:'Save an operating workflow',description:'Confirm your inspection checks and escalation timing, then save a workflow revision.'}
          : !reviewComplete
            ? {step:4,title:'Request an independent review',description:'Have a different authorized administrator or compliance officer review each saved workflow or policy.'}
            : !release
              ? {step:5,title:'Publish and activate',description:'Select the approved revisions, publish a release, then activate it.'}
              : null
  const go=(value:number)=>setParams({step:String(value)})
  return <div className="max-w-4xl space-y-6">
    <PageHeader title="Client onboarding" sub={`${tenantDisplayName(workspace?.configuration,workspace?.organisation?.name)} · Set up your operation, one step at a time.`}/>
    <section className="card p-5" aria-label="Next action">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">{release?'Setup complete':'Your next step'}</p>
      <h2 className="mt-1 text-xl font-bold">{nextAction?.title??'Operational configuration active'}</h2>
      <p className="mt-2">{nextAction?.description??`Release ${release?.version} is active. Open the operations workspace to continue.`}</p>
      {blocked.length>0&&<p className="mt-2 text-sm" role="status">Platform operator approval is still needed for: {blocked.join(', ')}.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {nextAction&&<button className="btn-primary px-4" onClick={()=>go(nextAction.step)}>Go to {steps[nextAction.step-1].toLowerCase()}</button>}
        <Link className="btn-secondary inline-flex items-center px-4" to="/workspace">Open workspace</Link>
      </div>
    </section>
    <nav aria-label="Setup steps"><ol className="grid gap-2 sm:grid-cols-5">{steps.map((label,index)=><li key={label}><button className={`w-full rounded-lg border p-3 text-left ${step===index+1?'border-blue-500 bg-blue-50':'border-slate-200'}`} aria-current={step===index+1?'step':undefined} onClick={()=>go(index+1)}><strong className="block text-sm">{index+1}. {label}</strong><span className="mt-1 block text-xs">{statuses[index]}</span></button></li>)}</ol></nav>
    {error&&<div role="alert" className="card p-4">{error}<button className="btn-secondary ml-3 px-3" onClick={()=>void refresh()}>Retry loading setup</button></div>}
    {!loaded&&!error&&<p role="status">Loading saved setup…</p>}
    {role!=='ADMIN'&&<p className="card p-4">Company setup belongs to an administrator. Reviewers must use their own authorized account; authors cannot approve their own procedures.</p>}
    {step===1&&<><Section title="Confirm operational sites" sub="Owner: company administrator. The onboarding workspace is an administrative placeholder.">
      {sites.map(site=><p key={site.id} className="mb-2 text-sm"><strong>{site.name}</strong> · {site.timezone} · {site.placeholder?'Administrative placeholder':'Operational site saved'}</p>)}
      {role==='ADMIN'&&<form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();void createSite()}}><label className="block text-sm">Site name<input required maxLength={200} className="field mt-1 w-full px-3" value={name} onChange={e=>setName(e.target.value)}/></label><label className="block text-sm">Site timezone<input required className="field mt-1 w-full px-3" value={timezone} onChange={e=>setTimezone(e.target.value)}/></label><button className="btn-primary px-4" disabled={busy}>{busy?'Creating site…':'Create operational site'}</button><p className="text-sm">The new site is assigned to your account. Operations still require an activated release.</p></form>}
    </Section>{role==='ADMIN'&&<><TenantSettings guided/>{workspace?.configuration?.modules?.docks!==true&&<p className="text-sm">Dock creation becomes available after the docks capability is activated. Record site settings now and return here to configure docks.</p>}{workspace?.configuration?.modules?.docks===true&&sites.some(s=>String(s.id)===workspace?.selectedFacility&&!s.placeholder)&&<details className="card p-4"><summary>Configure docks for the selected operational site</summary><DockSetup/></details>}</>}</>}
    {step===2&&role==='ADMIN'&&<><ModuleSelection onSaved={()=>void refresh()}/>{capabilitySaved&&<p role="status">Request saved. Continue to operating procedures.{blocked.length?` Platform operator approval needed: ${blocked.join(', ')}.`:''}</p>}</>}
    {step===3&&<><Section title="Define your operating procedures" sub="Owner: company administrator."><p>Save capabilities matching your request, site settings, and a workflow. Confirm inspection checks, escalation owners and timing before review.</p>{!companySaved&&<p className="mt-3">Prerequisite: save company configuration and a real site in step 1.</p>}{!capabilitySaved&&<p className="mt-3">Prerequisite: save a capability request in step 2.</p>}</Section>{role==='ADMIN'&&<PlatformConfiguration stage="configure"/>}</>}
    {step===4&&<><Section title="Hand procedures to an independent reviewer" sub="Owner: a different authorized administrator or compliance officer."><p>The author cannot approve their own workflow or policy, even after switching working roles. Ask the reviewer to sign in with their own account.</p><p className="mt-3">Review handoff: <code>/onboarding?step=4</code>. No notification is sent automatically.</p></Section><PlatformConfiguration stage="review"/>{role==='ADMIN'&&<details className="card p-4"><summary>Provision a reviewer account</summary><StaffProvisioning/></details>}</>}
    {step===5&&<><Section title="Publish and activate reviewed procedures" sub="Owner: company administrator."><p>Select exact saved revisions, publish a release, then activate it. Publication checks independent approvals, capability permissions and workflow dependencies.</p>{blocked.length>0&&<p className="mt-3">Blocked: ask the platform operator to approve {blocked.join(', ')}.</p>}{release&&<Link className="btn-primary mt-4 inline-flex px-4" to="/">Open operations workspace</Link>}</Section>{role==='ADMIN'&&<PlatformConfiguration stage="activate"/>}</>}
    <div className="flex justify-between gap-3"><button className="btn-secondary px-4" disabled={step===1} onClick={()=>go(step-1)}>Previous step</button>{step<5&&<button className="btn-primary px-4" onClick={()=>go(step+1)}>Continue to {steps[step]}</button>}</div>
    <details className="card p-4"><summary>Privacy and discovery responsibilities</summary><p className="mt-3 text-sm">Confirm company authority, providers, movement handoffs, data purpose, access, retention and processing arrangements before importing records. Use individual accounts and collect only required identifiers. Setup does not establish legal compliance.</p><Link className="mt-3 inline-block underline" to="/audit">View company audit history</Link></details>
  </div>
}
