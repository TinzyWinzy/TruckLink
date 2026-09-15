// Shared firebase-admin bootstrap for ID-token verification.
// Token verification needs only FIREBASE_PROJECT_ID (public JWKS); a service
// account is optional here but used when mounted (relay/push). Cached, lazy.

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { readFile } from 'node:fs/promises'

export interface FirebaseIdentity {
  uid: string
  role?: string
  facilities: string[]
}

let cached: App | null = null

export function firebaseProjectConfigured(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID)
}

async function loadCredential(): Promise<{ credential: ReturnType<typeof cert> } | null> {
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (file) {
    const key = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    return { credential: cert(key as never) }
  }
  if (inline) return { credential: cert(JSON.parse(inline) as never) }
  return null
}

/** Lazy singleton. Throws when FIREBASE_PROJECT_ID is unset. */
export async function getAdminApp(): Promise<App> {
  if (cached) return cached
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID required for firebase-admin (see server/.env.example)')
  if (getApps().length === 0) {
    const cred = await loadCredential()
    cached = cred ? initializeApp({ credential: cred.credential, projectId }) : initializeApp({ projectId })
  } else {
    cached = getApps()[0] as App
  }
  return cached
}

/** Verify a Firebase ID token (issued by the project's Auth). Throws on invalid/expired. */
export async function verifyIdToken(token: string): Promise<FirebaseIdentity> {
  const app = await getAdminApp()
  const decoded = await getAuth(app).verifyIdToken(token)
  const raw = decoded.facilities
  const facilities = Array.isArray(raw) ? raw.map(String).filter(Boolean) : []
  return {
    uid: decoded.uid,
    role: typeof decoded.role === 'string' ? decoded.role : undefined,
    facilities,
  }
}