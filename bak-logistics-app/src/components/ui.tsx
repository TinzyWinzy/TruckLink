import type { ReactNode } from 'react'
import { statusPillClass } from '../lib/status'

/** Shared yard kit — one visual language for buttons, status, sections (Law of Similarity). */

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
}: {
  title: string
  sub: string
  mode?: 'live' | 'demo'
  actions?: ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="page-title">{title}</h1>
        {mode && (
          <span className={mode === 'live' ? 'pill pill-live' : 'pill pill-demo'}>
            {mode === 'live' ? '● LIVE' : '■ DEMO'}
          </span>
        )}
        {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      <p className="page-sub mt-1">{sub}</p>
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'alert' | 'good' | 'plain' }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div
        className={`mt-1 text-3xl font-extrabold tabular-nums ${
          tone === 'alert' ? 'text-red-800' : tone === 'good' ? 'text-emerald-800' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
    </div>
  )
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
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-extrabold text-white">
            {step}
          </span>
        )}
        <div>
          <h2 className="text-base font-extrabold">{title}</h2>
          {sub && <p className="text-sm text-slate-600">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="card p-6 text-center" role="status">
      <p className="font-extrabold">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{sub}</p>
    </div>
  )
}
