// Pilot auth (Phase: security posture — hardened).
// Three tiers, each fail-closed in production:
//   - Tablet endpoints: Firebase ID tokens (user + facility from custom claims).
//   - ERP/WMS endpoints: separate WMS_API_KEY (never shipped to browsers).
//   - Ops endpoints (relay/publish/status): shared SYNC_API_KEY.
// Unset keys = OPEN dev-only mode with a boot warning. Production refuses to boot.

import type { NextFunction, Request, Response } from 'express'
import { firebaseProjectConfigured, verifyIdToken, type FirebaseIdentity } from './firebase/app.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: FirebaseIdentity
    }
  }
}

let warned = false

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

function warnOnce(msg: string): void {
  if (!warned) {
    warned = true
    console.warn(`[auth] ${msg}`)
  }
}

export function apiKeyConfigured(): boolean {
  return (process.env.SYNC_API_KEY ?? '').length >= 16
}

export function wmsKeyConfigured(): boolean {
  return (process.env.WMS_API_KEY ?? '').length >= 16
}

export function jwtSecretConfigured(): boolean {
  return (process.env.POWERSYNC_JWT_SECRET ?? '').length >= 32
}

/** Hard-fail boot in production when needed secrets are missing. Dev only warns. */
export function assertBootSecrets(): void {
  const missing: string[] = []
  if (!apiKeyConfigured()) missing.push('SYNC_API_KEY (16+ chars)')
  if (!wmsKeyConfigured()) missing.push('WMS_API_KEY (16+ chars) — separate from tablet credentials')
  if (!jwtSecretConfigured()) missing.push('POWERSYNC_JWT_SECRET (32+ chars)')
  if (!firebaseProjectConfigured()) missing.push('FIREBASE_PROJECT_ID (ID-token verification)')
  if (missing.length > 0) {
    if (isProd()) {
      throw new Error(`Production boot refuses: missing ${missing.join(', ')}. See server/.env.example`)
    }
    warnOnce(`dev mode with missing ${missing.join(', ')} — networked deploy would fail closed.`)
  }
}

function providedKey(req: Request, configured: boolean): string {
  const header = req.headers['x-api-key']
  if (typeof header === 'string' && header.length > 0) return header
  const auth = req.headers.authorization ?? ''
  // Accept `Bearer <key>` only when it matches the configured key.
  if (auth.startsWith('Bearer ') && configured && auth.slice(7) === (process.env.SYNC_API_KEY ?? '')) {
    return auth.slice(7)
  }
  return typeof header === 'string' ? header : ''
}

/** 401 when the shared key is configured and the request lacks it. Open in dev. */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!apiKeyConfigured()) {
    next()
    return
  }
  if (providedKey(req, apiKeyConfigured()) === process.env.SYNC_API_KEY) {
    next()
    return
  }
  res.status(401).json({ error: 'Unauthorized: valid X-API-Key required' })
}

/** 401 when the WMS key is configured and the request lacks it. Open in dev. */
export function requireWmsKey(req: Request, res: Response, next: NextFunction): void {
  if (!wmsKeyConfigured()) {
    next()
    return
  }
  const header = req.headers['x-api-key']
  if (typeof header === 'string' && header === process.env.WMS_API_KEY) {
    next()
    return
  }
  res.status(401).json({ error: 'Unauthorized: valid WMS X-API-Key required' })
}

/** Tablet identity: verified Firebase ID token. Dev falls back to a demo identity. */
export function requireFirebaseIdentity(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? ''
  if (auth.startsWith('Bearer ')) {
    verifyIdToken(auth.slice(7))
      .then((identity) => {
        req.identity = identity
        next()
      })
      .catch((err: unknown) => {
        console.warn('[auth] ID token rejected:', (err as Error).message)
        res.status(401).json({ error: 'Unauthorized: valid Firebase ID token required' })
      })
    return
  }
  if (!firebaseProjectConfigured()) {
    if (isProd()) {
      res.status(503).json({ error: 'Server auth not configured (FIREBASE_PROJECT_ID).' })
      return
    }
    warnOnce('FIREBASE_PROJECT_ID unset — tablet endpoints OPEN with a dev identity (dev only).')
    req.identity = { uid: 'dev-user', role: 'ADMIN', facilities: ['demo-facility'] }
    next()
    return
  }
  res.status(401).json({ error: 'Unauthorized: valid Firebase ID token required' })
}

/** True when a facility (if given) is one of the caller's facilities. */
export function identityHasFacility(identity: FirebaseIdentity | undefined, facilityId: string | null | undefined): boolean {
  if (!identity) return false
  if (!facilityId) return true
  return identity.facilities.includes(facilityId)
}