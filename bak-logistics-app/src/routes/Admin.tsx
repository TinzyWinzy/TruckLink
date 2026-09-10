import { useState } from 'react'
import { isLive } from '../lib/firebase'
import { useSession } from '../store/session'
import { PageHeader, Section } from '../components/ui'

export default function Admin() {
  const { role } = useSession()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = isLive()

  if (role !== 'ADMIN') {
    return (
      <div>
        <PageHeader title="Admin" sub="Restricted area." mode={live ? 'live' : 'demo'} />
        <p role="alert" className="card border-2 border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800">
          ✖ ADMIN role required. Current role: {role?.replace(/_/g, ' ') ?? 'none'}.
        </p>
      </div>
    )
  }

  async function seed() {
    if (!window.confirm('Seed demo-facility (docks, equipment, compliance config)? Idempotent merges only.')) return
    setBusy(true)
    setMessage(null)
    try {
      await (await import('../lib/live')).seedDemoFacility()
      setMessage('✔ Seeded — open Queue, then Docks.')
    } catch (e) {
      setMessage(`✖ ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Admin" sub={live ? 'Connected staging controls.' : 'Demo — seeding runs against staging once env vars are set.'} mode={live ? 'live' : 'demo'} />
      <div className="space-y-3">
        <Section title="Staging bootstrap" sub="One-time: facility, 4 docks, 3 equipment items, S.I. compliance config. Safe to re-run.">
          <button type="button" onClick={seed} disabled={busy || !live} className="btn-primary touch-target rounded-lg px-4 text-sm disabled:opacity-60">
            {busy ? 'Seeding…' : 'Seed demo facility'}
          </button>
          {message && <p role="status" className="mt-2 text-sm font-bold">{message}</p>}
        </Section>
        <Section title="Onboard a user" sub="Three steps in the Firebase console — role travels as a custom claim.">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Authentication → Add user (email + password).</li>
            <li>Custom claims: <code className="rounded bg-slate-100 px-1">{'{"role":"DISPATCH_SUPERVISOR","facilities":["demo-facility"]}'}</code></li>
            <li>User signs in on the gate screen.</li>
          </ol>
        </Section>
      </div>
    </div>
  )
}
