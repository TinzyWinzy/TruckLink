import type { Movement } from './MovementWorklist'

const stageLabels: Record<string, string> = {
  FLEET: 'Vehicle + driver',
  TRIP: 'Trip + visit link',
  EVIDENCE: 'Evidence review',
  SETUP: 'Load + context',
  INSPECTION: 'Inspection',
  APPROVAL: 'Approval',
  RELEASE: 'Release',
  EXIT: 'Gate exit',
  JOURNEY: 'Delivery',
}

const blockerStages: Record<string, string> = {
  VEHICLE: 'FLEET',
  TRIP: 'TRIP',
  RATINGS: 'EVIDENCE',
  LOAD: 'SETUP',
}

function roleLabel(role: string) {
  return role.replaceAll('_', ' ').toLowerCase()
}

export default function MovementRecoveryPanel({
  movement,
  onOpenStage,
}: {
  movement: Movement
  onOpenStage: (stage: string) => void
}) {
  const nextStage = movement.next_action.stage
  const nextStageLabel = stageLabels[nextStage] ?? nextStage.replaceAll('_', ' ')
  const remainingBlockers = movement.blockers.filter(
    blocker => blockerStages[blocker.code] !== nextStage,
  )
  const isQuarantined = movement.status === 'QUARANTINED' || movement.decision === 'QUARANTINE'
  const isAwaitingApproval = movement.status === 'PENDING_OVERRIDE'

  return (
    <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Movement recovery">
      <h3 className="text-base font-extrabold">What needs to happen next</h3>
      <p className="mt-1 text-sm">
        {isQuarantined
          ? 'This movement is on hold and is not cleared for release. Complete the required work below; the system will re-check current evidence.'
          : isAwaitingApproval
            ? 'This movement is waiting for an independent approval decision. Recording or assigning work does not approve it.'
            : "Start with the next required action. The system updates this guidance from the movement's current recorded state."}
      </p>

      <div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Next action</p>
        <p className="mt-1 font-bold">{movement.next_action.label}</p>
        <p className="mt-1 text-sm">
          Responsible: {movement.next_action.owner_roles.map(roleLabel).join(' / ') || 'Not specified'}.
        </p>
        <p className="text-sm">
          Handoff owner: {movement.next_action.assigned_person || 'Unassigned'}
          {movement.next_action.assigned_person && !movement.next_action.owner_available
            ? ' - reassignment is required because this owner is no longer eligible at this site.'
            : '.'}
        </p>
        <button
          className="btn-primary mt-3 min-h-11 px-4"
          onClick={() => onOpenStage(nextStage)}
        >
          Open {nextStageLabel}
        </button>
      </div>

      {remainingBlockers.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-bold">Other identified requirements</h4>
          <ul className="mt-2 space-y-2">
            {remainingBlockers.map(blocker => {
              const stage = blockerStages[blocker.code]
              const label = stage ? stageLabels[stage] : null
              return (
                <li key={blocker.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white p-3">
                  <div>
                    <p className="text-sm font-semibold">{blocker.title}</p>
                    <p className="text-xs text-slate-600">Responsible: {blocker.owner}</p>
                  </div>
                  {stage && label && (
                    <button
                      className="btn-secondary min-h-11 px-3"
                      onClick={() => onOpenStage(stage)}
                    >
                      Open {label}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : movement.blockers.length === 0 ? (
        <p className="mt-3 text-sm">
          No setup blockers are currently reported. This does not confirm inspection, approval, release, or clearance.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-slate-600">
        Opening a stage only takes you to its work area; it does not record a step or grant approval. Refresh after another person completes a handoff.
      </p>
    </section>
  )
}
