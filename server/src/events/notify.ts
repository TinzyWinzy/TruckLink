// Unified notify path: WhatsApp Cloud API first, SMS fallback, log last.
// Why WhatsApp-first for BAK: yard staff receive on cheap WhatsApp data
// bundles (no SMS airtime needed); we send over the VPS internet link and pay
// only Meta's per-conversation fee instead of per-SMS gateway rates.
//
// Setup (one time, Meta side): WhatsApp Business Account + phone number,
// `WHATSAPP_TOKEN` (system-user token), `WHATSAPP_PHONE_ID`, one approved
// UTILITY template (draft below), and staff opt-in recorded at onboarding.
// Without token configured this module degrades to SMS, then log — the pilot
// path is unchanged.

import { getSmsGateway } from './sms.js'

export type EscalationTarget = 'SUPERVISOR' | 'FACILITY_MANAGER' | 'BDM'

export interface QuarantineNotify {
  regNumber: string
  overloadKg: number | string
  overloadFeeUsd: number | string
  dueAfter: string
}

const TEMPLATE = process.env.WHATSAPP_TEMPLATE_QUARANTINE ?? 'quarantine_alert'
const LANG = process.env.WHATSAPP_TEMPLATE_LANG ?? 'en'

/** Draft for BAK's Meta template submission (UTILITY category):
 *  "BAK OpShield quarantine alert: {{1}} held at the gate ({{2}}kg over,
 *   ~${{3}} ZINARA exposure). Unacknowledged for {{4}}. Open the app to ack."
 */
export function quarantineTemplatePayload(
  to: string,
  n: QuarantineNotify,
  template = TEMPLATE,
  lang = LANG,
): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: String(n.regNumber) },
            { type: 'text', text: String(n.overloadKg) },
            { type: 'text', text: String(n.overloadFeeUsd) },
            { type: 'text', text: String(n.dueAfter) },
          ],
        },
      ],
    },
  }
}

function whatsappTo(target: EscalationTarget): string | undefined {
  if (target === 'FACILITY_MANAGER') return process.env.WHATSAPP_TO_FM
  if (target === 'BDM') return process.env.WHATSAPP_TO_BDM
  return process.env.WHATSAPP_TO_SUPERVISOR
}

function smsTo(target: EscalationTarget): string | undefined {
  if (target === 'FACILITY_MANAGER') return process.env.MANAGER_PHONE
  if (target === 'BDM') return process.env.BDM_PHONE
  return process.env.SUPERVISOR_PHONE
}

async function sendWhatsApp(to: string, n: QuarantineNotify): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN ?? ''
  const phoneId = process.env.WHATSAPP_PHONE_ID ?? ''
  if (!token || !phoneId) throw new Error('WhatsApp not configured')
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(quarantineTemplatePayload(to, n)),
  })
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`)
}

/** WhatsApp → SMS → log. Throws only when a configured sender fails (retry). */
export async function notifyEscalation(
  target: EscalationTarget,
  text: string,
  n: QuarantineNotify,
): Promise<'whatsapp' | 'sms' | 'log'> {
  const waTo = whatsappTo(target)
  if (waTo) {
    try {
      await sendWhatsApp(waTo, n)
      return 'whatsapp'
    } catch (err) {
      console.warn(`[notify] WhatsApp failed, falling back to SMS: ${(err as Error).message}`)
    }
  }
  const smsToAddr = smsTo(target)
  if (smsToAddr) {
    await getSmsGateway().send(smsToAddr, text)
    return 'sms'
  }
  console.log(`[escalation:${target}] no channel configured — ${text}`)
  return 'log'
}
