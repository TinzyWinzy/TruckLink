import { Link } from 'react-router-dom'
import { useLive } from '../lib/liveGate'
import { ROLE_CARDS, SI_CARDS } from '../lib/demoData'
import { PageHeader, Section } from '../components/ui'

/** Information Hub — the yard's answer wall. Visit by every role. */
export default function Hub() {
  const live = useLive()
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Information hub"
        sub="How Trucki works, how evidence informs decisions, who does what, and what to do when things break."
        mode={live ? 'live' : 'demo'}
      />
      <div className="space-y-3">
        <Section title="What is this system?" sub="Trucki in one paragraph">
          <p className="text-[15px] leading-relaxed">
            Trucki is a local-first overlay on the yard: it registers arrivals, assigns docks,
            evaluates dispatch evidence against the selected versioned ruleset <strong>before</strong> the truck leaves, and keeps
            an append-only audit trail. It complements your WMS with evidence-based evaluation and controlled release.
          </p>
          <Link to="/guide" className="btn-primary touch-target mt-3 inline-block rounded-lg px-4 py-2 text-sm">
            Start the gatekeeper's walkthrough →
          </Link>
        </Section>

        <Section title="The law that pays for this" sub="S.I. 129/2015 + S.I. 159/2022">
          {SI_CARDS.map((c) => (
            <div key={c.title} className="card mb-2 border-l-4 border-l-amber-500 p-4">
              <p className="font-extrabold">{c.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{c.body}</p>
            </div>
          ))}
        </Section>

        <Section title="Who does what" sub="Available actions depend on your assigned working role">
          <ul className="space-y-2">
            {ROLE_CARDS.map((r) => (
              <li key={r.role} className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <strong className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{r.role.replace(/_/g, ' ')}</strong>
                <span className="text-slate-700">{r.blurb}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="When things break" sub="Yard-first fixes, in order">
          <ul className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            <li><strong>Offline (■ OFFLINE):</strong> keep registering. Entries queue with ⏳ and sync on reconnect. Dock moves wait for signal.</li>
            <li><strong>PIN fails:</strong> check caps on TRK-07-DEMO, 4–12 digits, no trailing space. After 3 tries, ask your supervisor. Do not share PINs.</li>
            <li><strong>Scale won't pair:</strong> use Chrome on the yard tablet → ⚖ Read from weighbridge → pick the scale port. Typing still works.</li>
            <li><strong>Permission error:</strong> sign out → sign in again. Still blocked → ask your supervisor to check your account.</li>
            <li><strong>Quarantined truck at the gate:</strong> do not wave it through. Rebalance at Bay 4 or run the override path. Both are audited.</li>
          </ul>
        </Section>

        <Section title="Module map" sub="Every screen, one line">
          <ul className="grid gap-2 text-sm">
            {[
              ['Shift queue', '/queue', 'Register arrivals, release cleared trucks.'],
              ['Pre-departure check', '/compliance', '4 steps: vehicle → weights → checks → validate.'],
              ['Dock board', '/docks', 'Tap a free dock → oldest truck assigns.'],
              ['Alerts', '/alerts', 'CRITICAL first; acknowledge what you own.'],
              ['Shift performance', '/reports', 'Overdue, turnaround, CSV export for the manager.'],
              ['Audit trail', '/audit', 'Hash-chained proof. Read-only for most.'],
            ].map(([label, to, blurb]) => (
              <li key={to} className="card flex items-center gap-3 px-4 py-3">
                <Link to={to} className="font-extrabold underline">{label}</Link>
                <span className="text-slate-600">{blurb}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}
