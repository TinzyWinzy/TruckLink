import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isLive } from '../lib/firebase'
import { TAFADZWA_STEPS } from '../lib/demoData'
import { PageHeader, Section } from '../components/ui'

/** System Guide — Tafadzwa's click-by-click walkthrough. Progress persists per tablet. */
const KEY = 'bak-guide-progress-v1'

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export default function Guide() {
  const [done, setDone] = useState<Record<string, boolean>>(load)
  const live = isLive()
  const finished = TAFADZWA_STEPS.filter((s) => done[s.n]).length

  function toggle(n: string) {
    setDone((d) => {
      const next = { ...d, [n]: !d[n] }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // private-mode tablets — progress just won't persist.
      }
      return next
    })
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={`Tafadzwa's walkthrough · ${finished}/${TAFADZWA_STEPS.length}`}
        sub={live ? 'Yard walkthrough — ticks save on this tablet. Do it once here, you can do it on shift.' : 'Practice walkthrough — training shift, works offline. Ticks save on this tablet.'}
        mode={live ? 'live' : 'demo'}
      />
      <div className="mb-4 h-2.5 overflow-hidden rounded bg-slate-200" role="img" aria-label={`Progress ${finished} of ${TAFADZWA_STEPS.length}`}>
        <div className="h-2.5 rounded bg-emerald-700 transition-all" style={{ width: `${(finished / TAFADZWA_STEPS.length) * 100}%` }} />
      </div>
      {finished === TAFADZWA_STEPS.length && (
        <p role="status" className="card mb-3 border-2 border-emerald-700 bg-emerald-50 p-4 text-sm font-extrabold text-emerald-900">
          ✔ Walkthrough complete — you can run a shift. Next: do steps 1–2 on a real truck with a supervisor watching.
        </p>
      )}
      <div className="space-y-3">
        {TAFADZWA_STEPS.map((s) => {
          const checked = !!done[s.n]
          return (
            <Section key={s.n} step={s.n} title={s.title} sub={s.where}>
              <p className="text-[15px] leading-relaxed">{s.what}</p>
              <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
                <strong>Tafadzwa, note:</strong> {s.tafadzwa}
              </p>
              <p className="mt-2 text-sm font-semibold text-emerald-900">Done when: {s.done}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={s.to} className="btn-primary touch-target rounded-lg px-4 py-2 text-sm">
                  Open {s.where.split('(')[0].trim()} →
                </Link>
                <button
                  type="button"
                  onClick={() => toggle(s.n)}
                  aria-pressed={checked}
                  className={`touch-target rounded-lg border-2 px-4 py-2 text-sm font-extrabold ${checked ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  {checked ? '✔ Done' : 'Mark done'}
                </button>
              </div>
            </Section>
          )
        })}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        Stuck? Open the <Link to="/hub" className="underline">Information hub</Link> → When things break.
      </p>
    </div>
  )
}
