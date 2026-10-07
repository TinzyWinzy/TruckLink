import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { getRegulatoryContext, inspectOperational, type Attempt, type RegulatoryContext } from '../lib/regulatory'
import { useSession } from '../store/session'
import { PageHeader, Section, StatusPill } from './ui'
import InspectionSetup, {type InspectionSetupData} from './InspectionSetup'
import { Link } from 'react-router-dom'

const ATTESTATIONS = ['driver-license', 'vehicle-reg', 'cargo-manifest', 'weight-cert', 'axle-calc']

export default function VersionedInspection({ entryId, data: initialData, changeEntry,onChanged }: {
  entryId: string; data: RegulatoryContext; changeEntry: (value: string) => void;onChanged?:()=>void
}) {
  const { role, workspace } = useSession()
  const [data,setData] = useState(initialData)
  const [editing,setEditing] = useState(false)
  const [summary,setSummary] = useState<InspectionSetupData|null>(null)
  const [summaryError,setSummaryError] = useState('')
  const [summaryRetry,setSummaryRetry] = useState(0)
  useEffect(()=>{let active=true;apiFetch<InspectionSetupData>(`/regulatory/queue/${entryId}/setup/`).then(d=>{if(active){setSummary(d);setSummaryError('')}}).catch(e=>{if(active)setSummaryError((e as Error).message)});return()=>{active=false}},[entryId,summaryRetry])
  const [weights, setWeights] = useState<string[]>(() => (data.configuration?.rated_axle_kg ?? ['0']).map(() => ''))
  const [total, setTotal] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [attempt, setAttempt] = useState<Attempt | null>(data.attempt)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const extraChecks = data.rulesets.flatMap(r => r.content.units.filter(u => u.definition.kind === 'CHECKLIST').map(u => u.definition.item_id!))
  const checks = [...new Set([...(data.workflow?.mandatory_checks ?? workspace?.configuration?.content.workflow.mandatory_checks ?? ATTESTATIONS), ...extraChecks])]
  const operator = role === 'ADMIN' || role === 'OPERATIONS_SUPERVISOR'
  const readOnly = !['ADMIN','OPERATIONS_SUPERVISOR','DISPATCH_SUPERVISOR'].includes(role??'')
  const ready = Boolean(data.context && data.configuration && !data.readiness_error)
  async function reloadSetup() {
    const updated=await getRegulatoryContext(entryId)
    setData(updated);setAttempt(updated.attempt);setEditing(false)
    setWeights((updated.configuration?.rated_axle_kg??[]).map(()=>''));setTotal('');setChecked({})
    setMessage('Operational setup saved. Dispatch must record a fresh inspection; historical attempts are retained.')
    setSummaryRetry(n=>n+1)
  }

  async function run() {
    setBusy(true)
    setMessage('')
    try {
      const response = await inspectOperational({ queue_entry: Number(entryId), context_id: data.context?.id ?? null,
        axle_weights: weights, total_weight: total, checklist_results: checked, client_key: crypto.randomUUID() })
      setAttempt(response.attempt)
      setMessage('Inspection recorded. Release checks the current evidence and effective rules again at exit.')
      onChanged?.()
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }

  async function override(approve?: boolean) {
    if (!attempt) return
    setBusy(true)
    try {
      if (approve === undefined) {
        await apiFetch(`/regulatory/attempts/${attempt.id}/override-request/`, { method: 'POST', body: { reason } })
        setMessage('Override requested. A separate supervisor must review it.')
      } else {
        const detail = await apiFetch<{ requests: { id: number }[] }>(`/regulatory/attempts/${attempt.id}/`)
        const request = detail.requests.at(-1)
        if (!request) throw new Error('No pending override request.')
        await apiFetch(`/regulatory/override-requests/${request.id}/approve/`, { method: 'POST', body: { approved: approve, reason } })
        setMessage(approve ? 'Independent approval recorded; original inspection remains unchanged.' : 'Request rejected. Remediate and inspect again.')
      }
      setAttempt((await getRegulatoryContext(entryId)).attempt)
      onChanged?.()
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }

  const trip = summary?.trips?.find(t=>t.id===data.context?.trip)
  return <div className="inspection-workspace space-y-5">
    <PageHeader title="Operational gate inspection" sub="Resolve missing records before recording an inspection." />
    <section className="inspection-identity" aria-label="Movement identity">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2>{summary?.entry?.registration??`Visit ${entryId}`}</h2><StatusPill status={summary?.entry?.status??attempt?.decision??'Context pending'}/></div>
      <dl className="inspection-facts"><div><dt>Driver</dt><dd>{trip?.driver_name??(data.context?`Recorded driver ${data.context.driver}`:'Not linked')}</dd></div><div><dt>Destination</dt><dd>{data.context?.destination??'Not linked'}</dd></div><div><dt>Trip / load</dt><dd>{data.context?`${data.context.trip} / ${data.context.load}`:'Not linked'}</dd></div></dl>
      <p className="mt-3 text-sm text-slate-600">Visit {entryId}{readOnly?' · Read-only inspection access.':''}</p>
    </section>
    {summaryError&&<p role="alert" className="text-sm">Movement summary unavailable. <button className="report-text-link" onClick={()=>setSummaryRetry(n=>n+1)}>Retry summary</button></p>}
    {!ready&&<section className="inspection-prerequisites" aria-label="Missing inspection records"><h2 className="text-lg font-bold">Complete setup before inspection</h2><p role="status" className="mt-1 text-sm">Setup required. Inspection and release remain blocked.</p>
      {summary?.blockers?.length ? <ul className="prerequisite-list">{summary.blockers.map(b=><li key={b.code}><span aria-hidden="true">○</span><div><strong>{b.title}</strong><p>Responsible role: {b.owner}</p></div></li>)}</ul> : <p className="my-3 text-sm">Vehicle, driver, load and route evidence have not been recorded or are not ready for inspection.</p>}
      {!readOnly&&<button className="btn-primary mt-3 px-4" onClick={()=>setEditing(v=>!v)} aria-expanded={editing}>{editing?'Close setup':'Complete operational setup'}</button>}
    </section>}
    <details className="operational-details inspection-context"><summary>Recorded context and rule details</summary>
    <label className="mt-3 block max-w-xs text-sm font-bold">Queue entry ID
      <input className="field touch-target mt-1 w-full px-3" value={entryId} onChange={e => changeEntry(e.target.value)} />
    </label>
    <div className="mt-4 space-y-2 text-sm">
      {data.context && data.configuration ? <>
        <p>{data.configuration.vehicle_class} · configuration revision {data.configuration.revision} · {data.configuration.review_status}</p>
        <p>{data.context.origin} → {data.context.destination} · {data.context.route_type} · {data.context.jurisdictions.join(', ')}</p>
        <p>Driver {data.context.driver} · trip {data.context.trip} · load {data.context.load}</p>
        <p>Recorded ratings: axles {data.configuration.rated_axle_kg.join(' / ')} kg · gross {data.configuration.rated_gross_kg} kg</p>
      </> : <p className="text-sm">Vehicle, driver, load and route evidence have not been recorded. An authorised dispatch or operations supervisor must complete setup before inspection.</p>}
      {data.readiness_error && <p role="alert" className="mt-2 text-amber-900">{data.readiness_error}</p>}
      {data.rulesets.map(r => <p key={r.id} className="mt-2 text-sm">{r.content.name} v{r.content.version} · {r.content.jurisdiction} · effective {r.content.effective_from} to {r.content.effective_to}</p>)}
      <p className="mt-2 text-xs text-slate-600">Published records reflect recorded human review. No instrument or monetary penalty is asserted to be verified law by this screen.</p>
    </div></details>
    {ready&&!readOnly&&<button className="btn-secondary px-4" onClick={()=>setEditing(v=>!v)} aria-expanded={editing}>{editing?'Close setup':'Review or correct operational setup'}</button>}
    {editing&&!readOnly&&<InspectionSetup entryId={entryId} onSaved={reloadSetup} showBlockers={false}/>}
    {ready&&!readOnly&&<>
    <Section title="Measured mass (kg)">
      <div className="grid grid-cols-2 gap-3">
        {weights.map((value, i) => <label key={i} className="text-sm font-bold">Axle {i + 1}
          <input className="field touch-target mt-1 w-full px-3" inputMode="decimal" value={value} onChange={e => setWeights(old => old.map((v, n) => n === i ? e.target.value : v))} />
        </label>)}
        <label className="text-sm font-bold">Total
          <input className="field touch-target mt-1 w-full px-3" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} />
        </label>
      </div>
    </Section>
    <Section title="Inspection attestations">
      {checks.map(id => <label key={id} className="flex min-h-12 items-center gap-3 border-b">
        <input type="checkbox" className="h-6 w-6" checked={!!checked[id]} onChange={e => setChecked(old => ({ ...old, [id]: e.target.checked }))} />{id.replace(/-/g, ' ')}
      </label>)}
      <button className="btn-primary touch-target mt-3 w-full" disabled={busy || role !== 'DISPATCH_SUPERVISOR'} onClick={run}>{busy ? 'Recording…' : 'Record versioned inspection'}</button>
      {role!=='DISPATCH_SUPERVISOR'&&<p className="mt-3 text-sm">Dispatch Supervisor records measured mass and inspection attestations. Operations reviews exceptions and coordinates release.</p>}
    </Section>
    </>}
    {attempt && <Section title={`Inspection ${attempt.id} · ${attempt.decision}`}>
      {readOnly&&attempt.input_snapshot&&<details><summary className="cursor-pointer font-bold">Recorded measurements and attestations</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(attempt.input_snapshot,null,2)}</pre></details>}
      {attempt.decision==='REVIEW_REQUIRED'?<p>Setup prevented this inspection from evaluating readiness. This recorded attempt is retained; complete setup and request a fresh inspection.</p>:<p>Readiness {attempt.result.readiness_percent}%. Readiness does not grant release.</p>}
      <ul className="inspection-control-list mt-3">{attempt.result.controls.map(c => <li key={c.id}>
        <div className="flex flex-wrap items-center gap-2"><StatusPill status={c.status}/><span className="text-sm font-semibold">{c.reason}</span></div>
        {(c.provenance || c.expected !== undefined || c.missing)&&<details className="operational-details mt-2"><summary>Evidence details</summary>
        {c.provenance && <p className="mt-1 text-sm">{c.provenance.source.title} · {c.provenance.source.kind} · {c.provenance.source.provision} · revision {c.provenance.source.revision} · ruleset {c.provenance.ruleset_id}</p>}
        {c.expected !== undefined && <p className="mt-1 break-words text-sm">Expected: {JSON.stringify(c.expected)} · measured: {JSON.stringify(c.measured)}</p>}
        {c.missing && <p>Missing: {c.missing.join(', ')}</p>}</details>}
      </li>)}</ul>
      {attempt.result.override_eligible && operator && <div className="mt-4 space-y-2">
        <label className="block text-sm font-bold">Review reason<input className="field touch-target mt-1 w-full px-3" value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button className="touch-target rounded border px-3" disabled={busy || !reason.trim()} onClick={() => override()}>Request exception</button>
          <button className="touch-target rounded border px-3" disabled={busy || !reason.trim()} onClick={() => override(true)}>Approve independently</button>
          <button className="touch-target rounded border px-3" disabled={busy || !reason.trim()} onClick={() => override(false)}>Reject</button>
        </div>
      </div>}
      {['PASS','PASS_WITH_WARNINGS'].includes(attempt.decision)&&<p className="mt-4 text-sm">Release is a separate authorised action in the <Link className="underline" to={`/dispatch?entry=${entryId}`}>guided movement</Link>. Current evidence and rules are checked again at release.</p>}
    </Section>}
    {message && <p role="status" className="rounded border p-3">{message}</p>}
  </div>
}
