import type { ReactNode } from 'react'
import { statusPillClass } from '../lib/status'

/** Shared yard kit — gantry-industrial language: eyebrow + title + rule, spine cards, data numerals. */

export function StatusPill({ status, symbol }: { status: string; symbol?: string }) {
  return (
    <span className={statusPillClass(status)}>
      {symbol && <span aria-hidden="true">{symbol}</span>}
      {status}
    </span>
  )
}

export function PageHeader({
  title,
  sub,
  mode,
  actions,
  eyebrow,
}: {
  title: string
  sub?: string
  mode?: 'live' | 'demo'
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="page-heading mb-6">
      {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="page-title">{title}</h1>
        {mode === 'demo' && (
          <span className="pill pill-demo">
            ■ PRACTICE
          </span>
        )}
        {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      {sub && <p className="page-sub mt-1.5">{sub}</p>}

    </div>
  )
}

export function Stat({ label, value, tone, hint, unavailable = false }: { label: string; value: string; tone?: 'alert' | 'good' | 'plain'; hint?: string; unavailable?: boolean }) {
  const bar = tone === 'alert' ? 'bg-red-700' : tone === 'good' ? 'bg-emerald-700' : 'bg-slate-300'
  return (
    <div className={`metric-cell p-4${unavailable ? ' metric-unavailable' : ''}`}>
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      <div
        className={`metric-value tnum mt-1 text-3xl font-extrabold tracking-tight ${
          tone === 'alert' ? 'text-red-800' : tone === 'good' ? 'text-emerald-800' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {hint && <p className="mt-2 text-sm leading-relaxed text-slate-600">{hint}</p>}
      {!unavailable && <div aria-hidden="true" className="mt-2 h-1 w-10 rounded-full bg-slate-200">
        <div className={`h-1 w-full rounded-full ${bar}`} />
      </div>}
    </div>
  )
}

export function spineForStatus(status: string): string {
  const s = status.toUpperCase()
  if (/(FAIL|QUARANTINED|CRITICAL|RELEASED|PASS|AVAILABLE|STABLE|ACKNOWLEDGED)/.test(s))
    return /(FAIL|QUARANTINED|CRITICAL)/.test(s) ? 'spine-fail' : 'spine-pass'
  if (/(PENDING|QUEUED|ASSIGNED|LOADING|ACTIVE|HIGH)/.test(s)) return 'spine-queued'
  if (/(WARN|MEDIUM|RESERVED|MAINTENANCE|OVERDUE)/.test(s)) return 'spine-warn'
  return 'spine-neutral'
}

export function Section({
  step,
  title,
  sub,
  children,
}: {
  step?: string
  title: string
  sub?: string
  children: ReactNode
}) {
  return (
    <section className="card p-4 sm:p-5" aria-label={title}>
      <div className="mb-3 flex items-start gap-3">
        {step && (
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 font-data text-sm font-bold text-amber-400 shadow-sm">
            {step}
          </span>
        )}
        <div>
          <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ title, sub, icon = '○' }: { title: string; sub: string; icon?: string }) {
  return (
    <div className="card p-6 text-center" role="status">
      <p aria-hidden="true" className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-500">
        {icon}
      </p>
      <p className="mt-2 font-extrabold tracking-tight">{title}</p>
      <p className="mx-auto mt-1 max-w-[46ch] text-sm leading-relaxed text-slate-600">{sub}</p>
    </div>
  )
}
