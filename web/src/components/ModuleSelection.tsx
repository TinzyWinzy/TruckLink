import { useEffect, useState } from 'react'
import { readSubscription, requiredModules, saveModuleSelection, type ModuleKey, type Subscription } from '../lib/subscriptions'
import { Section } from './ui'

export default function ModuleSelection() {
  const [data,setData]=useState<Subscription|null>(null)
  const [selected,setSelected]=useState<ModuleKey[]>([])
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
  useEffect(()=>{let active=true;void readSubscription().then(value=>{if(active){setData(value);setSelected(value.selection?.modules??value.entitlement.modules)}}).catch(()=>{if(active)setError('Module choices could not be loaded. Retry when connected.')});return()=>{active=false}},[reload])
  function reloadModules(){setError('');setMessage('');setData(null);setReload(n=>n+1)}
  async function save(){if(!data)return;setBusy(true);setError('');setMessage('');try{const value=await saveModuleSelection(selected,data.selection?.version??0);setData(value);setSelected(value.selection!.modules);setMessage('Module request saved. Subscription approval and operational activation are separate steps.')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const included=data?requiredModules(selected,data.catalogue):[]
  return <Section title="Choose your modules" sub="Request the capabilities your company needs. Saving a request does not activate access or take payment.">
    {!data&&!error&&<p role="status">Loading module choices…</p>}
    {error&&<div role="alert"><p>{error}</p><button type="button" className="btn-secondary mt-3 px-4" disabled={busy} onClick={reloadModules}>Reload modules</button></div>}
    {data&&<form onSubmit={e=>{e.preventDefault();void save()}}>
      <p className="mb-4 text-sm">Access status: {data.entitlement.state.toLowerCase().replaceAll('_',' ')}{data.entitlement.basis==='LEGACY_CONTINUITY'?' (existing workspace continuity)':''}. Pricing and checkout are not configured.</p>
      <div className="grid gap-3 sm:grid-cols-2">{data.catalogue.map(row=>{
        const requested=included.includes(row.key),active=data.effective_modules[row.key],granted=data.entitlement.modules.includes(row.key)
        return <label key={row.key} className={`rounded-lg border p-4 ${requested?'border-blue-400 bg-blue-50/40':'border-slate-200'}`}>
          <span className="flex items-start gap-3"><input aria-label={row.name} className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={row.included||selected.includes(row.key)} disabled={row.included||busy} onChange={e=>setSelected(values=>e.target.checked?[...values,row.key]:values.filter(key=>key!==row.key))}/><span><strong>{row.name}</strong><span className="mt-1 block text-sm text-slate-600">{row.description}</span></span></span>
          <span className="mt-3 block text-sm font-semibold">{active?'Active':granted?'Entitled; configuration pending':requested?'Included in this request':'Available to request'}</span>
          {row.requires.length>0&&<span className="mt-1 block text-sm text-slate-600">Includes required controls: {row.requires.map(key=>data.catalogue.find(r=>r.key===key)?.name??key).join(', ')}.</span>}
        </label>
      })}</div>
      <p className="mt-4 text-sm">Yard operations always include inspection and release safeguards. Required controls are included automatically. Audit history remains included.</p>
      <p className="mt-2 text-sm">Request includes: {included.map(key=>data.catalogue.find(row=>row.key===key)?.name??key).join(', ')}.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn-primary px-4" disabled={busy}>{busy?'Saving request…':'Save module request'}</button><button type="button" className="btn-secondary px-4" disabled={busy} onClick={reloadModules}>Reload modules</button><span className="text-sm">{data.selection?`Saved request v${data.selection.version}`:'No module request saved'}</span></div>
      {message&&<p className="mt-3 text-sm" role="status">{message}</p>}
      {data.unavailable.map(row=><p className="mt-4 text-sm text-slate-600" key={row.key}><strong>{row.name}:</strong> {row.reason}</p>)}
    </form>}
  </Section>
}
