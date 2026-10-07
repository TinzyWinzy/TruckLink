import { apiFetch } from './api'

export interface Control {
  id: string
  status: string
  reason: string
  expected?: unknown
  measured?: unknown
  missing?: string[]
  provenance?: { ruleset_id: number; digest: string; source: { title: string; provision: string; revision: number; kind: string } }
}
export interface Attempt {
  id: number
  decision: string
  creator: number
  input_snapshot?:Record<string,unknown>
  result: { controls: Control[]; readiness_percent: number; override_eligible: boolean; engine_version: string; monetary_penalty: null }
}
export interface RegulatoryContext {
  workflow?: { mandatory_checks: string[]; version: number; digest: string }
  mode: 'VERSIONED' | 'LEGACY_DEMO'
  context: { id: number; driver: number; trip: number; load: number; jurisdictions: string[]; route_type: string; origin: string; destination: string } | null
  configuration: { id: number; revision: number; vehicle: number; vehicle_class: string; rated_axle_kg: string[]; rated_gross_kg: string; review_status: string } | null
  readiness_error: string | null
  rulesets: { id: number | string; digest: string; content: { name: string; version: number; jurisdiction: string; effective_from: string; effective_to: string; units: { definition: { kind: string; item_id?: string } }[] } }[]
  attempt: Attempt | null
}

export function getRegulatoryContext(entryId: string) {
  return apiFetch<RegulatoryContext>(`/regulatory/queue/${encodeURIComponent(entryId)}/context/`)
}

export function inspectOperational(input: { queue_entry: number; context_id: number | null; axle_weights: string[]; total_weight: string; checklist_results: Record<string, boolean>; client_key: string }) {
  return apiFetch<{ attempt: Attempt; replayed: boolean }>('/regulatory/evaluate/', { method: 'POST', body: input })
}
