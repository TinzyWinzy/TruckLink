import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { validateLoad } from '../lib/validation/compliance'
import { enqueueOfflineAction, isOnline } from '../lib/offline/db'
import { useLive } from '../lib/liveGate'
import { useSession } from '../store/session'
import { connectWeighbridge, isWebSerialSupported, type SerialConnection } from '../lib/weighbridge/serial'
import type { ChecklistItem } from '../lib/live'
import { SI_ROUTES, SI_ROUTE_LABELS } from '../lib/validation/siTables'
import { PageHeader, Section, StatusPill } from '../components/ui'
import VersionedInspection from '../components/VersionedInspection'
import { getRegulatoryContext, type RegulatoryContext } from '../lib/regulatory'

const VEHICLES = ['DEFAULT', 'FLATBED', 'TANKER', 'REFRIGERATED', 'CONTAINER', 'DRY_VAN'] as const

const DEMO_CHECKLIST: ChecklistItem[] = [
  { itemId: 'driver-license', label: 'Driver license verified', mandatory: true },
  { itemId: 'vehicle-reg', label: 'Vehicle registration verified', mandatory: true },
  { itemId: 'cargo-manifest', label: 'Cargo manifest attached', mandatory: true },
  { itemId: 'weight-cert', label: 'Weight certificate recorded', mandatory: true },
  { itemId: 'axle-calc', label: 'Axle load calculation within limits', mandatory: true },
]

export default function ComplianceCheck() {
  const { userId, role, displayName } = useSession()
  const [entryId, setEntryId] = useState('')
  const [regulatory, setRegulatory] = useState<{ entryId: string; data: RegulatoryContext } | null>(null)
  const [contextError, setContextError] = useState('')
  const [vehicleType, setVehicleType] = useState<string>('DEFAULT')
  const [routeType, setRouteType] = useState<string>('BEITBRIDGE')
  const [limits, setLimits] = useState<number[]>([8000, 9000, 9000])
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEMO_CHECKLIST)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [w1, setW1] = useState('6000')
  const [w2, setW2] = useState('8000')
  const [w3, setW3] = useState('8000')
  const [total, setTotal] = useState('22000')
  const [gvm, setGvm] = useState('24000')
  const [result, setResult] = useState<string | null>(null)
  const [passed, setPassed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [scaleMsg, setScaleMsg] = useState<string | null>(null)
  const [scaleStable, setScaleStable] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideMsg, setOverrideMsg] = useState<string | null>(null)
  const connRef = useRef<SerialConnection | null>(null)
  const live = useLive()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (!live || !entryId.trim()) return
    let cancelled = false
    getRegulatoryContext(entryId.trim()).then(data => {
      if (!cancelled) { setRegulatory({ entryId: entryId.trim(), data }); setContextError('') }
    }).catch(e => { if (!cancelled) setContextError((e as Error).message) })
    return () => { cancelled = true }
  }, [live, entryId])

  // Queue board "Check →" shortcut (?entry=) fills the ID — no more typing
  // IDs from memory. Runs once per link; manual edits afterwards are kept.
  useEffect(() => {
    const fromBoard = (searchParams.get('entry') ?? '').trim()
    if (fromBoard) setEntryId(fromBoard)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    import('../lib/live').then(async (m) => {
      const cfg = await m.getComplianceConfig(vehicleType, routeType)
      if (!cancelled) {
        setLimits(cfg.limits)
        setChecklist(cfg.checklist)
      }
    }).catch(() => {
      // Demo fallback stays.
    })
    return () => {
      cancelled = true
    }
  }, [vehicleType, routeType])

  const mandatoryOpen = checklist.filter((c) => c.mandatory && !checked[c.itemId])
  const checksDone = checklist.filter((c) => checked[c.itemId]).length

  async function run() {
    setBusy(true)
    setPassed(null)
    try {
      if (mandatoryOpen.length > 0) {
        setResult(`✖ Complete mandatory checks first: ${mandatoryOpen.map((c) => c.label).join('; ')}`)
        return
      }
      const weights: [number, number, number] = [Number(w1), Number(w2), Number(w3)]
      if (!live) {
        const r = validateLoad({
          axleConfiguration: '2-4-2',
          measuredWeights: [...weights],
          limits: [...limits],
          totalWeight: Number(total),
          gvmRating: Number(gvm),
        })
        const ok = r.overallStatus === 'PASS'
        setPassed(ok)
        setResult(ok ? '✔ PASS — practice check. On the yard, release the truck from the Queue board.' : `✖ FAIL — quarantine: ${r.violations.join('; ')}`)
        return
      }
      if (!entryId.trim()) {
        setResult('✖ Enter the queue entry ID first (copy it from the Queue board).')
        return
      }
      const payload = {
        queueEntryId: entryId.trim(),
        weights,
        limits: limits as [number, number, number],
        routeType,
        vehicleType,
        totalWeight: Number(total),
        gvmRating: Number(gvm),
        supervisorId: userId ?? 'unknown',
        checklistResults: { ...checked },
      }
      if (!isOnline()) {
        await enqueueOfflineAction('compliance.submit', { ...payload })
        setResult('⏳ Offline — check queued, will validate + write on reconnect.')
        return
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const status = await (await import('../lib/live')).submitComplianceLive({ ...payload, key })
      const ok = status === 'PASS'
      setPassed(ok)
      setResult(ok ? '✔ PASS — demo inspection only, using unverified pilot limits. Release from the Queue board requires the current inspection.' : '✖ FAIL — vehicle QUARANTINED. Use the quarantine panel below or fix the load.')
    } catch (e) {
      setResult(`✖ ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function readScale() {
    setScaleMsg(null)
    if (!isWebSerialSupported()) {
      setScaleMsg('✖ This browser can’t talk to the scale — use Chrome on the yard tablet. Typing still works.')
      return
    }
    try {
      setScaleMsg('⏳ Select the weighbridge indicator port…')
      connRef.current = await connectWeighbridge((r) => {
        setScaleStable(r.stable)
        if (r.stable) {
          setTotal(String(r.weightKg))
          setScaleMsg(`✔ Stable ${r.weightKg} kg captured — confirm axles below, then Validate.`)
        } else {
          setScaleMsg(`… Reading ${r.weightKg} kg — hold the vehicle still for a stable capture.`)
        }
      })
    } catch (e) {
      setScaleMsg(`✖ ${(e as Error).message}`)
    }
  }

  async function requestOverride() {
    setOverrideMsg(null)
    if (!live) {
      setOverrideMsg('Practice — overrides need a yard entry.')
      return
    }
    if (!entryId.trim()) {
      setOverrideMsg('✖ Enter the quarantined queue entry ID first.')
      return
    }
    try {
      const actorId = userId ?? displayName
      await (await import('../lib/live')).requestOverrideLive(entryId.trim(), overrideReason, actorId, displayName)
      setOverrideMsg('⏳ Requested → PENDING_OVERRIDE. A supervisor must approve below.')
    } catch (e) {
      setOverrideMsg(`✖ ${(e as Error).message}`)
    }
  }

  async function decideOverride(approved: boolean) {
    setOverrideMsg(null)
    if (!live || !entryId.trim()) {
      setOverrideMsg('✖ Enter the pending queue entry ID first.')
      return
    }
    try {
      await (await import('../lib/live')).approveOverrideLive(entryId.trim(), approved, userId ?? displayName)
      setOverrideMsg(approved ? '✔ Approved → OVERRIDE_APPROVED. Release from the Queue board.' : '✖ Rejected → back to QUARANTINED.')
    } catch (e) {
      setOverrideMsg(`✖ ${(e as Error).message}`)
    }
  }

  const canApprove = role === 'OPERATIONS_SUPERVISOR' || role === 'ADMIN'

  if (live && regulatory?.entryId === entryId.trim() && regulatory.data.mode === 'VERSIONED') {
    return <VersionedInspection key={`${entryId}:${regulatory.data.context?.id ?? 'missing'}`} entryId={entryId} data={regulatory.data} changeEntry={setEntryId} />
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Pre-departure check"
        sub="Four short steps at the side of the vehicle. A failed check quarantines the truck — it cannot be released."
        mode={live ? 'live' : 'demo'}
      />
      <p role="note" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Pilot limits are LEGACY_DEMO_UNVERIFIED. This inspection does not establish legal compliance.
        Operational sites require verified regulatory configuration before evaluation or release.
      </p>
      <div className="space-y-3">
        {contextError && <p role="alert">Context unavailable: {contextError}. Operational evaluation requires recorded context.</p>}
        <Section step="1" title="Vehicle" sub="Which truck are you standing next to?">
          <label className="block text-sm font-bold">
              Queue entry ID
              <input value={entryId} onChange={(e) => setEntryId(e.target.value)} placeholder={live ? 'Tap Check → on the Queue board' : 'Training reference — tap Check → on the Queue board'} className="field touch-target mt-1 w-full px-3 font-data" />
            </label>
          <label className="mt-2 block text-sm font-bold">
            Corridor / route (S.I. table)
            <select value={routeType} onChange={(e) => setRouteType(e.target.value)} className="field touch-target mt-1 w-full px-3">
              {SI_ROUTES.map((r) => (
                <option key={r} value={r}>{SI_ROUTE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-sm font-bold">
            Vehicle type (S.I. table)
            <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="field touch-target mt-1 w-full px-3">
              {VEHICLES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-xs font-semibold text-slate-600">Axle limits ({routeType}): {limits.join(' / ')} kg · pilot values — confirm with VID schedule</p>
        </Section>

        <Section step="2" title="Weights" sub="Capture the scale first — stable readings fill Total automatically.">
          <button type="button" onClick={readScale} className="touch-target rounded-lg border-2 border-slate-900 px-4 text-sm font-extrabold">
            ⚖ Read from weighbridge
          </button>
          {scaleStable && <span className="ml-2"><StatusPill status="STABLE" symbol="●" /></span>}
          {scaleMsg && <p role="status" className="mt-2 text-sm font-semibold">{scaleMsg}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ['Axle 1', w1, setW1],
                ['Axle 2', w2, setW2],
                ['Axle 3', w3, setW3],
                ['Total', total, setTotal],
                ['GVM', gvm, setGvm],
              ] as [string, string, (v: string) => void][]
            ).map(([label, value, set]) => (
              <label key={label} className="block text-sm font-bold">
                {label} <span className="font-normal text-slate-500">kg</span>
                <input inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} className="field touch-target mt-1 w-full px-3 tabular-nums" />
              </label>
            ))}
          </div>
        </Section>

        <Section step="3" title={`Checks · ${checksDone}/${checklist.length}`} sub="Tick what you verified with your own eyes.">
          {checklist.map((c) => (
            <label key={c.itemId} className="flex min-h-12 items-center gap-3 border-b py-1 text-[15px] last:border-0">
              <input type="checkbox" checked={!!checked[c.itemId]} onChange={(e) => setChecked((s) => ({ ...s, [c.itemId]: e.target.checked }))} className="h-6 w-6 accent-slate-900" />
              <span>{c.label}</span>
              {c.mandatory && <span className="ml-auto text-xs font-bold text-red-700">REQUIRED</span>}
            </label>
          ))}
        </Section>

        <Section step="4" title="Validate" sub="PASS enables release · FAIL quarantines + alerts the yard.">
          <button type="button" onClick={run} disabled={busy} className="btn-primary touch-target w-full px-4 text-lg">
            {busy ? 'Validating…' : 'Validate load ✔'}
          </button>
          {result && (
            <div role="status" aria-live="polite" className={`mt-3 rounded-xl border-2 p-4 ${passed === true ? 'border-emerald-700 bg-emerald-50' : passed === false ? 'border-red-700 bg-red-50' : 'border-slate-300 bg-slate-50'}`}>
              <p className="text-[15px] font-bold">{result}</p>
            </div>
          )}
        </Section>

        <Section title="Quarantine override" sub="Separate panel, separate approver — the requester cannot approve their own override.">
          <label className="block text-sm font-bold">
            Reason
            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. re-weigh confirms decant complete" className="field touch-target mt-1 w-full px-3" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={requestOverride} className="touch-target rounded-lg border px-4 text-sm font-bold">
              Request override
            </button>
            <button type="button" onClick={() => void decideOverride(true)} disabled={!canApprove} className="btn-accent touch-target rounded-lg px-4 text-sm disabled:opacity-50">
              Approve ✔
            </button>
            <button type="button" onClick={() => void decideOverride(false)} disabled={!canApprove} className="touch-target rounded-lg border border-red-300 px-4 text-sm font-bold text-red-800 disabled:opacity-50">
              Reject ✖
            </button>
          </div>
          {!canApprove && <p className="mt-1 text-xs text-slate-600">Approval needs Operations Supervisor, Facility Manager or Admin (you: {role?.replace(/_/g, ' ') ?? 'none'}).</p>}
          {overrideMsg && <p role="status" className="mt-2 text-sm font-bold">{overrideMsg}</p>}
        </Section>
      </div>
    </div>
  )
}
