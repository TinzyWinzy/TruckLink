// Phase 5 WMS/ERP bridge: canonical OpShield events -> legacy ERP shapes.
// Profiles: generic-http (default), sap, syspro. The profile only adjusts the
// envelope — field mapping stays explicit below so BAK IT can verify each line
// against their WMS import spec during UAT.

export type ErpProfile = 'generic-http' | 'sap' | 'syspro'

export interface WmsTicket {
  queueEntryId: string
  facilityId: string
  regNumber: string
  status: string
  exitTimestamp?: string | null
  overloadKg?: number
  overloadFeeUsd?: number
  dwellSeconds?: number | null
  source: string
}

export interface ErpEnvelope {
  profile: ErpProfile
  endpoint: string
  body: Record<string, unknown>
}

export function erpProfile(): ErpProfile {
  const raw = (process.env.WMS_ERP_PROFILE ?? 'generic-http').toLowerCase()
  if (raw === 'sap' || raw === 'syspro') return raw
  return 'generic-http'
}

/** Pure mapping — unit-tested, no I/O. */
export function toErpTicket(msg: WmsTicket, profile: ErpProfile = erpProfile()): Record<string, unknown> {
  const core = {
    externalRef: msg.queueEntryId,
    facility: msg.facilityId,
    vehicleReg: msg.regNumber,
    gateStatus: msg.status,
    exitedAt: msg.exitTimestamp ?? null,
    dwellSeconds: msg.dwellSeconds ?? null,
    overloadKg: msg.overloadKg ?? 0,
    overloadFeeUsd: msg.overloadFeeUsd ?? 0,
    sourceSystem: 'BAK-OPSHIELD',
  }
  if (profile === 'sap') return { ...core, idocType: 'YARD_GATE_TICKET', source: msg.source }
  if (profile === 'syspro') return { ...core, businessObject: 'GateTicket', source: msg.source }
  return { ...core, source: msg.source }
}

/** POST a mapped ticket. Throws on non-2xx so the worker nacks for retry. */
export async function postTicketToErp(msg: WmsTicket): Promise<ErpEnvelope> {
  const url = process.env.WMS_EXPORT_URL
  if (!url) throw new Error('WMS_EXPORT_URL is not configured (pilot log mode)')
  const profile = erpProfile()
  const body = toErpTicket(msg, profile)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.WMS_TIMEOUT_MS ?? 8000))
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.WMS_EXPORT_TOKEN ? { Authorization: `Bearer ${process.env.WMS_EXPORT_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`WMS export ${res.status}: ${await res.text()}`)
    return { profile, endpoint: url, body }
  } finally {
    clearTimeout(timer)
  }
}
