// $0 push leg (FCM). Sends via firebase-admin messaging, initialized lazily
// from the same service-account file as the Firestore relay — no new secrets.
// Pure helpers (target->roles, payload) are unit-tested; transport needs creds.

import type { EscalationTarget } from './notify.js'

/** Which system roles should hear each escalation target. */
export function rolesForTarget(target: EscalationTarget): string[] {
  if (target === 'FACILITY_MANAGER') return ['FACILITY_MANAGER']
  if (target === 'BDM') return ['EXECUTIVE', 'ADMIN']
  return ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR']
}

/** Tokens for the roles behind a target, in one facility. Empty when nobody subscribed. */
export async function tokensForTarget(facilityId: string, target: EscalationTarget): Promise<string[]> {
  const { pool } = await import('../db.js')
  const res = await pool.query(
    `SELECT DISTINCT fcm_token AS token FROM push_subscriptions
     WHERE facility_id = $1 AND role = ANY($2)`,
    [facilityId, rolesForTarget(target)],
  )
  return (res.rows as Array<{ token: string }>).map((r) => r.token)
}

export interface PushPayload {
  title: string
  body: string
  url: string
}

/** FCM v1 message body (data-only + notification for heads-up display). */
export function fcmMessage(token: string, p: PushPayload): Record<string, unknown> {
  return {
    token,
    notification: { title: p.title, body: p.body },
    data: { url: p.url, tag: 'opshield-escalation' },
    android: { priority: 'high', notification: { channelId: 'opshield-critical', clickAction: 'FLIP' } },
  }
}

let messaging: { send(msg: Record<string, unknown>): Promise<string> } | null = null
let initFailed = false

async function getMessaging(): Promise<typeof messaging> {
  if (messaging || initFailed) return messaging
  try {
    const { readFile } = await import('node:fs/promises')
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    const projectId = process.env.FIREBASE_PROJECT_ID
    if (!projectId || (!file && !inline)) return null
    const key = file ? JSON.parse(await readFile(file, 'utf8')) : JSON.parse(inline as string)
    const { initializeApp, getApps, cert } = await import('firebase-admin/app')
    const { getMessaging: getMsg } = await import('firebase-admin/messaging')
    if (getApps().length === 0) initializeApp({ credential: cert(key), projectId })
    messaging = getMsg() as unknown as NonNullable<typeof messaging>
  } catch (err) {
    initFailed = true
    console.warn('[push] FCM init failed (push disabled):', (err as Error).message)
  }
  return messaging
}

/** Returns tokens successfully sent to. Never throws (fallback chain decides). */
export async function sendPush(tokens: string[], p: PushPayload): Promise<string[]> {
  const m = await getMessaging()
  if (!m || tokens.length === 0) return []
  const sent: string[] = []
  for (const token of tokens) {
    try {
      await m.send(fcmMessage(token, p))
      sent.push(token)
    } catch (err) {
      console.warn('[push] send failed for a token:', (err as Error).message)
    }
  }
  return sent
}
