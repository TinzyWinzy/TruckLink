import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { getRegulatoryContext, inspectOperational, type Attempt, type RegulatoryContext } from '../lib/regulatory'
import { useSession } from '../store/session'
import { PageHeader, Section } from './ui'
import InspectionSetup from './InspectionSetup'
import { Link } from 'react-router-dom'

const ATTESTATIONS = ['driver-license', 'vehicle-reg', 'cargo-manifest', 'weight-cert', 'axle-calc']

export default function VersionedInspection({ entryId, data: initialData, changeEntry,onChanged }: {
  entryId: string; data: RegulatoryContext; changeEntry: (value: string) => void;onChanged?:()=>void
}) {
  const { role, workspace } = useSession()
  const [data,setData] = useState(initialData)
  const [editing,setEditing] = useState(!initialData.context)
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

  return <div className="max-w-3xl space-y-4">
    <PageHeader title="Operational gate inspection" sub="Recorded vehicle evidence, effective rule versions and a separate release decision." mode="live" />
    {readOnly&&<p className="text-sm">Read-only inspection access. Your role cannot change context, record measurements, approve operational exceptions or release this visit.</p>}
    <label className="block text-sm font-bold">Queue entry ID
      <input className="field touch-target mt-1 w-full px-3" value={entryId} onChange={e => changeEntry(e.target.value)} />
    </label>
    <Section title="Recorded context">
      {data.context && data.configuration ? <>
        <p>{data.configuration.vehicle_class} · configuration revision {data.configuration.revision} · {data.configuration.review_status}</p>
        <p>{data.context.origin} → {data.context.destination} · {data.context.route_type} · {data.context.jurisdictions.join(', ')}</p>
        <p>Driver {data.context.driver} · trip {data.context.trip} · load {data.context.load}</p>
        <p>Recorded ratings: axles {data.configuration.rated_axle_kg.join(' / ')} kg · gross {data.configuration.rated_gross_kg} kg</p>
      </> : <p className="text-sm">Vehicle, driver, load and route evidence have not been recorded. An authorised dispatch or operations supervisor must complete setup before inspection.</p>}
      {data.readiness_error && <p role="alert" className="mt-2 text-amber-900">{data.readiness_error}</p>}
      {data.rulesets.map(r => <p key={r.id} className="mt-2 text-sm">{r.content.name} v{r.content.version} · {r.content.jurisdiction} · effective {r.content.effective_from} to {r.content.effective_to}</p>)}
      <p className="mt-2 text-xs text-slate-600">Published records reflect recorded human review. No instrument or monetary penalty is asserted to be verified law by this screen.</p>
      {data.context&&!readOnly&&<button className="mt-3 min-h-12 underline" onClick={()=>setEditing(v=>!v)}>{editing?'Close setup':'Review or correct operational setup'}</button>}
    </Section>
    {editing&&!readOnly&&<InspectionSetup entryId={entryId} onSaved={reloadSetup}/>}
    {!ready&&<p role="status" className="border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">Setup required. Inspection and release remain blocked until the operational context, reviewed vehicle evidence and applicable rules are ready.</p>}
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
      <ul className="mt-3 space-y-3">{attempt.result.controls.map(c => <li key={c.id} className="rounded border p-3">
        <strong>{c.status}</strong> · {c.reason}
        {c.provenance && <p className="mt-1 text-xs">{c.provenance.source.title} · {c.provenance.source.kind} · {c.provenance.source.provision} · revision {c.provenance.source.revision} · ruleset {c.provenance.ruleset_id}</p>}
        {c.expected !== undefined && <p className="mt-1 text-xs">Expected: {JSON.stringify(c.expected)} · measured: {JSON.stringify(c.measured)}</p>}
        {c.missing && <p>Missing: {c.missing.join(', ')}</p>}
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
