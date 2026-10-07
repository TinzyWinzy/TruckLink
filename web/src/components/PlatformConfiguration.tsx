import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useSession } from '../store/session'
import type { TenantConfiguration } from '../lib/tenant'
import { Section } from './ui'

interface Revision { id:number; kind:string; key:string; version:number; content:Record<string,unknown>; facility_id:number|null }
interface Release { id:number; version:number; artifact_ids:number[]; configuration_id:number }
interface Registry { modules:Record<string,string[]>; release:Release|null; activation_version:number }
const kinds = ['MODULES','WORKFLOW','SITE','PERMISSIONS','POLICY','PACK_ASSIGNMENT','INTEGRATION']

export default function PlatformConfiguration() {
  const { workspace } = useSession()
  const [registry,setRegistry] = useState<Registry|null>(null)
  const [revisions,setRevisions] = useState<Revision[]>([])
  const [releases,setReleases] = useState<Release[]>([])
  const [selected,setSelected] = useState<number[]>([])
  const [kind,setKind] = useState('MODULES')
  const [key,setKey] = useState('validated-capabilities')
  const [facility,setFacility] = useState('')
  const [content,setContent] = useState('{}')
  const [reason,setReason] = useState('')
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)
  const [reviewId,setReviewId] = useState('')
  const [activateId,setActivateId] = useState('')
  const [configId,setConfigId] = useState<number|null>(null)
  const load = useCallback(async () => {
    const organisationId = useSession.getState().workspace?.organisation?.id
    const [r,versions,published,c] = await Promise.all([
      apiFetch<Registry>('/tenant/registry/'), apiFetch<{revisions:Revision[]}>('/tenant/revisions/'),
      apiFetch<{releases:Release[]}>('/tenant/releases/'), apiFetch<{configuration:TenantConfiguration}>('/tenant/configuration/'),
    ])
    const current = useSession.getState().workspace
    if (current?.organisation?.id !== organisationId) return
    setRegistry(r); setRevisions(versions.revisions); setReleases(published.releases)
    setConfigId(c.configuration.id ?? r.release?.configuration_id ?? null)
    setContent(old=>old==='{}'?JSON.stringify(Object.fromEntries(Object.keys(r.modules).map(k=>[k,k==='audit'||c.configuration.modules?.[k]!==false])),null,2):old)
    setSelected(r.release?.artifact_ids ?? [])
    if (current) useSession.getState().setWorkspace({...current,configuration:c.configuration})
  }, [])
  useEffect(() => { void Promise.resolve().then(load).catch(error => setMessage(error.message)) }, [load])
  async function command(path:string,body:Record<string,unknown>,success:string) {
    setBusy(true); setMessage('')
    try { await apiFetch(path,{method:'POST',body}); await load(); setMessage(success) }
    catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  function edit(row:Revision) { setKind(row.kind); setKey(row.key); setFacility(row.facility_id ? String(row.facility_id) : ''); setContent(JSON.stringify(row.content,null,2)) }
  function selectKind(value:string) {
    setKind(value); setKey(value.toLowerCase().replace('_','-')); setFacility('')
    const examples:Record<string,unknown> = {
      MODULES:Object.fromEntries(Object.keys(registry?.modules ?? {}).map(k => [k,true])),
      WORKFLOW:{template:'yard-lifecycle-v1',transitions:['arrival','dock','inspect','request_override','approve_override','release','update_status'],workflow:workspace?.configuration?.content.workflow},
      SITE:{timezone:'UTC',operating_parameters:{mode:'OPERATIONS'}}, PERMISSIONS:{grants:{}},
      POLICY:{classification:'TENANT_POLICY',document_ref:'',document_sha256:'',controls:[]},
      PACK_ASSIGNMENT:{pack_id:null,jurisdiction:'',route_type:'DOMESTIC'},
      INTEGRATION:{adapter:'twilio-v1',enabled:false,env_prefix:''},
    }
    setContent(JSON.stringify(examples[value],null,2))
  }
  async function saveRevision() {
    let data:unknown
    try { data = JSON.parse(content) } catch { setMessage('Configuration must be valid JSON.'); return }
    const latest = revisions.filter(r => r.kind === kind && r.key === key).reduce((n,r) => Math.max(n,r.version),0)
    await command('/tenant/revisions/',{kind,key,content:data,facility:facility ? Number(facility) : null,expected_version:latest,reason},'Configuration revision saved. Review safety-related changes before publishing.')
  }
  function changeContent(update:(value:Record<string,unknown>)=>Record<string,unknown>){try{setContent(JSON.stringify(update(JSON.parse(content)),null,2))}catch{setMessage('Fix the advanced configuration JSON before using guided fields.')}}
  let draft:Record<string,unknown>={};try{draft=JSON.parse(content)}catch{ /* Advanced editor reports validation on save. */ }
  const flow=(draft.workflow??{}) as {mandatory_checks?:string[];inspection_max_age_seconds?:number;escalation_minutes?:{FM:number;EXEC:number}}
  if (!registry) return <p role="status">{message || 'Loading platform configuration'}</p>
  return <Section title="Modules and workflow releases" sub={'Active release ' + (registry.release?.version ?? 'not yet configured') + '. Publication and activation are separate.'}>
    <div className="space-y-4">
      <p className="text-sm">Workflows and company policies require a different authorized reviewer. Regulatory packs come from the platform catalogue. Integration bindings require a platform operator.</p>
      <div className="flex flex-wrap gap-2">{Object.keys(registry.modules).map(module => <span key={module} className="rounded border px-2 py-1 text-xs">{module}: {workspace?.configuration?.modules?.[module] === false ? 'disabled' : 'enabled'}</span>)}</div>
      <button className="btn-secondary px-3" disabled={busy} onClick={() => void load().catch(error => setMessage(error.message))}>Refresh configuration versions</button>
      <label className="block text-sm">Release change reason<textarea className="field mt-1 w-full p-3" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Author configuration revision</legend>
        <label className="block text-sm">Configuration type<select className="field mt-1 w-full" value={kind} onChange={e => selectKind(e.target.value)}>{kinds.map(k => <option key={k}>{k}</option>)}</select></label>
        <label className="block text-sm">Configuration key<input className="field mt-1 w-full px-3" value={key} onChange={e => setKey(e.target.value)} /></label>
        <label className="block text-sm">Configuration site<select className="field mt-1 w-full" value={facility} onChange={e => setFacility(e.target.value)}><option value="">Tenant-wide</option>{workspace?.facilities.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {kind==='MODULES'&&<div className="grid gap-2 sm:grid-cols-2">{Object.entries(registry.modules).map(([module,dependencies])=><label key={module} className="text-sm"><input type="checkbox" checked={draft[module]===true} disabled={module==='audit'} onChange={e=>changeContent(v=>({...v,[module]:e.target.checked}))}/> {module}{dependencies.length?` (requires ${dependencies.join(', ')})`:''}</label>)}</div>}
        {kind==='SITE'&&<><label className="block text-sm">Site timezone<input className="field mt-1 w-full px-3" placeholder="Africa/Harare" value={String(draft.timezone??'')} onChange={e=>changeContent(v=>({...v,timezone:e.target.value}))}/></label><p className="text-sm">Choose an existing site above. Operational sites retain operational controls. Training mode is available only for sites already provisioned as DEMO.</p></>}
        {kind==='WORKFLOW'&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Inspection validity (seconds, 1–86400)<input type="number" min="1" max="86400" className="field mt-1 w-full px-3" value={flow.inspection_max_age_seconds??''} onChange={e=>changeContent(v=>({...v,workflow:{...flow,inspection_max_age_seconds:Number(e.target.value)}}))}/></label>{(['FM','EXEC'] as const).map(owner=><label key={owner} className="text-sm">{owner==='FM'?'Facility Manager':'Executive'} escalation (minutes)<input type="number" min="1" max="10080" className="field mt-1 w-full px-3" value={flow.escalation_minutes?.[owner]??''} onChange={e=>changeContent(v=>({...v,workflow:{...flow,escalation_minutes:{...flow.escalation_minutes,[owner]:Number(e.target.value)}}}))}/></label>)}<p className="text-sm sm:col-span-2">Required checks: {flow.mandatory_checks?.join(', ')||'Choose a current workflow revision first'}. Changes require independent review and release activation.</p></div>}
        {!['MODULES','SITE','WORKFLOW'].includes(kind)&&<p className="text-sm">This configuration requires a supported schema and a qualified configuration author. Use the advanced editor and review the full document before saving.</p>}
        <details><summary className="cursor-pointer text-sm font-bold">Advanced configuration JSON</summary><label className="block text-sm">Revision configuration<textarea className="field mt-1 w-full p-3 font-mono text-xs" rows={10} value={content} onChange={e => setContent(e.target.value)} /></label></details>
        <p className="text-sm">Proposed revision: {kind.toLowerCase().replaceAll('_',' ')} / {key||'key required'} / {facility?workspace?.facilities.find(s=>String(s.id)===facility)?.name:'Tenant-wide'}. Saving creates a version; publication and activation follow separately.</p>
        <button className="btn-secondary px-3" disabled={!reason.trim()} onClick={() => void saveRevision()}>Save configuration revision</button>
      </fieldset>
      <div className="space-y-2"><h3 className="font-semibold">Select exact revisions for a release</h3>{revisions.map(row => <div key={row.id} className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={'Include revision ' + row.id} checked={selected.includes(row.id)} onChange={e => setSelected(old => e.target.checked ? [...old,row.id] : old.filter(id => id !== row.id))} /><button className="text-left underline" onClick={() => edit(row)}>{row.kind} · {row.key} · v{row.version} · #{row.id}</button></div>)}</div>
      <button className="btn-secondary px-3" disabled={busy || !configId || !selected.length || !reason.trim()} onClick={() => void command('/tenant/releases/',{artifact_ids:selected,configuration_id:configId,expected_version:Math.max(0,...releases.map(r => r.version)),reason},'Release published. Activate it when ready.')}>Publish tenant release</button>
      <div className="space-y-2"><h3 className="font-semibold">Independent review</h3><label className="block text-sm">Revision to review<select className="field mt-1 w-full" value={reviewId} onChange={e => setReviewId(e.target.value)}><option value="">Choose revision</option>{revisions.filter(r => ['WORKFLOW','POLICY'].includes(r.kind)).map(r => <option key={r.id} value={r.id}>{r.key} v{r.version} · #{r.id}</option>)}</select></label><div className="flex gap-2">{[true,false].map(approved => <button key={String(approved)} className="btn-secondary px-3" disabled={busy || !reviewId || !reason.trim()} onClick={() => void command('/tenant/revisions/' + reviewId + '/review/',{approved,reason},approved ? 'Independent approval recorded.' : 'Approval revoked.')}>{approved ? 'Approve revision' : 'Revoke approval'}</button>)}</div></div>
      <label className="block text-sm">Release to activate<select className="field mt-1 w-full" value={activateId} onChange={e => setActivateId(e.target.value)}><option value="">Choose published release</option>{releases.map(r => <option key={r.id} value={r.id}>Release v{r.version} · #{r.id}</option>)}</select></label>
      <button className="btn-primary px-3" disabled={busy || !activateId || !reason.trim()} onClick={() => void command('/tenant/releases/' + activateId + '/activate/',{expected_version:registry.activation_version,reason},'Tenant release activated. Operational changes require current evaluation.')}>Activate tenant release</button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  </Section>
}
