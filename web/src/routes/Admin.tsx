import { useState } from 'react'
import { useLive } from '../lib/liveGate'
import { useSession } from '../store/session'
import { PageHeader, Section } from '../components/ui'
import TenantSettings from '../components/TenantSettings'
import PlatformConfiguration from '../components/PlatformConfiguration'
import VehicleEvidenceDesk from '../components/VehicleEvidenceDesk'
import FleetRegistration from '../components/FleetRegistration'
import StaffProvisioning from '../components/StaffProvisioning'
import MovementWorklist from '../components/MovementWorklist'
import DockSetup from '../components/DockSetup'

export default function Admin() {
  const { role } = useSession()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = useLive()

  if (role !== 'ADMIN') {
    return (
      <div>
        <PageHeader title="Admin" sub="Restricted area." mode={live ? 'live' : 'demo'} />
        <p role="alert" className="card border-2 border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800">
          ✖ Yard setup is for admins only. Your job: {role?.replace(/_/g, ' ') ?? 'none'}.
        </p>
      </div>
    )
  }

  async function seed() {
    if (!window.confirm('Set up the yard (docks, equipment, axle rules + practice shift)? Safe to run again.')) return
    setBusy(true)
    setMessage(null)
    try {
      await (await import('../lib/live')).seedDemoFacility()
      setMessage('✔ Yard ready. Open Queue, then Docks.')
    } catch (e) {
      setMessage(`✖ ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Admin" sub={live ? 'Yard setup controls.' : 'Setup. Works once the tablet is connected.'} mode={live ? 'live' : 'demo'} />
      <div className="space-y-3">
        <MovementWorklist />
        {live&&<DockSetup/>}
        {live && <FleetRegistration />}
        {live && <StaffProvisioning />}
        {live && <VehicleEvidenceDesk />}
        {live && <TenantSettings />}
        {live && <PlatformConfiguration />}
        <Section title="Practice yard bootstrap" sub="For facilities explicitly configured in demo mode. Production sites reject this command; use actual fleet and evidence records for operational reviews.">
          <button type="button" onClick={seed} disabled={busy || !live} className="btn-primary touch-target rounded-lg px-4 text-sm disabled:opacity-60">
            {busy ? 'Setting up…' : 'Set up yard + practice shift'}
          </button>
          {message && <p role="status" className="mt-2 text-sm font-bold">{message}</p>}
          {message && message.startsWith('✔') && (
            <p className="mt-2 text-sm">Next: open <a className="underline" href="/guide">/guide</a> with the gatekeeper, then <a className="underline" href="/queue">/queue</a>.</p>
          )}
        </Section>
      </div>
    </div>
  )
}
