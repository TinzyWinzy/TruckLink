import { useState } from 'react'
import { apiFetch, facilityId } from '../lib/api'
import { useLive } from '../lib/liveGate'
import { PageHeader, Section, Stat } from '../components/ui'

type Report = {
  synthetic: boolean; model_version: string; result_digest: string
  organisation: { id: number; name: string }; facility: { id: number; name: string }
  summary: { modelled_serviced: number; blocked: number; average_wait_minutes: number; average_turnaround_minutes: number; dock_utilisation_percent: number; scenario_checks_passed: number }
  scenarios: { id: string; title: string; expected: string; matches_expected: boolean; result: { decision: string; override_eligible: boolean; controls: { id: string; status: string; reason: string }[] } }[]
  movements: { reference: string; decision: string; scenario: string; arrival_minutes: number; wait_minutes: number | null; dock: number | null }[]
  limitations: string[]
}

export default function Modelling() {
  const live = useLive()
  const [inputs, setInputs] = useState({ seed: 42, vehicles: 72, docks: 3, arrivals_per_hour: 18, service_minutes: 12 })
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true); setError(null); setReport(null)
    try { setReport(await apiFetch<Report>('/modelling/run/', { method: 'POST', body: { ...inputs, facility: facilityId } })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'synthetic-model-evidence.json'; a.click(); URL.revokeObjectURL(url)
  }
  const labels = { seed: 'Random seed', vehicles: 'Vehicles', docks: 'Docks', arrivals_per_hour: 'Arrivals per hour', service_minutes: 'Mean service minutes' }
  return <div className="space-y-5">
    <PageHeader title="Synthetic modelling" sub="Test evaluation behaviour and yard capacity with reproducible, invented data." />
    <p className="border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">Synthetic data only. No operational records are created. Limits and evidence assumptions are invented, not verified law. Blocked vehicles are not modelled as released.</p>
    <Section title="Model assumptions" sub="The same seed and assumptions reproduce the same result. Compare dock capacity or arrival pressure by rerunning the model.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(labels).map(([key, label]) => <label key={key} className="text-sm">{label}<input type="number" className="field mt-1 w-full px-3" value={inputs[key as keyof typeof inputs]} onChange={e => setInputs({ ...inputs, [key]: Number(e.target.value) })} /></label>)}</div>
      <button className="btn-primary mt-4 px-5" disabled={busy || !live} onClick={run}>{busy ? 'Running model' : 'Run synthetic model'}</button>
      {!live && <p className="mt-3 text-sm">Sign in to a tenant workspace to run the server evaluator.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    </Section>
    {report && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{report.organisation.name} / {report.facility.name} · Synthetic results</p><button onClick={download} className="btn-primary px-4">Export model evidence</button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Modelled serviced" value={String(report.summary.modelled_serviced)} /><Stat label="Blocked" value={String(report.summary.blocked)} tone="alert" /><Stat label="Average wait" value={`${report.summary.average_wait_minutes} min`} /><Stat label="Dock utilisation" value={`${report.summary.dock_utilisation_percent}%`} /></div>
      <Section title="Evaluation proof" sub={`${report.summary.scenario_checks_passed} of 7 expected decisions matched the versioned server evaluator.`}>
        {report.scenarios.map(s => <details key={s.id} className="border-b border-slate-200 py-3"><summary className="cursor-pointer text-sm"><strong>{s.result.decision}</strong> · {s.title} · {s.matches_expected ? 'Matched' : 'Unexpected result'}</summary><p className="my-2 text-sm">Expected {s.expected}. Independent override eligible: {s.result.override_eligible ? 'Yes' : 'No'}.</p><ul className="space-y-1 text-xs">{s.result.controls.map(c => <li key={c.id}>{c.status} · {c.reason}</li>)}</ul></details>)}
      </Section>
      <Section title="Synthetic vehicle outcomes" sub="Arrival times are model minutes. Serviced vehicles satisfy the synthetic evaluator; blocked vehicles do not occupy a modelled dock."><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Reference','Arrival','Decision','Wait','Dock'].map(h => <th key={h} className="py-3 pr-4">{h}</th>)}</tr></thead><tbody>{report.movements.map(r => <tr key={r.reference} className="border-t border-slate-200"><td className="py-3 pr-4 font-data">{r.reference}</td><td>{r.arrival_minutes} min</td><td>{r.decision}</td><td>{r.wait_minutes == null ? 'Blocked' : `${r.wait_minutes} min`}</td><td>{r.dock ?? 'None'}</td></tr>)}</tbody></table></div></Section>
      <p className="break-all text-xs text-slate-600">{report.model_version} · Result digest {report.result_digest}</p>
      <ul className="list-disc pl-5 text-sm text-slate-600">{report.limitations.map(l => <li key={l}>{l}</li>)}</ul>
    </>}
  </div>
}
