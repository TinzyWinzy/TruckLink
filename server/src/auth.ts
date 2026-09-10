// Pilot API-key auth (Phase: security posture).
// Yard tablets share one key (VITE_SYNC_API_KEY -> X-API-Key). This stops
// casual internet writes; it is NOT per-user auth. Before multi-tenant prod,
// verify Firebase ID tokens here with firebase-admin (see SECURITY.md).
// When SYNC_API_KEY is unset the API stays open for local dev and warns.

import type { NextFunction, Request, Response } from 'express'

let warned = false

export function apiKeyConfigured(): boolean {
  return (process.env.SYNC_API_KEY ?? '').length >= 16
}

export function authBootWarning(): void {
  if (!apiKeyConfigured() && !warned) {
    warned = true
    console.warn('[auth] SYNC_API_KEY unset — API is OPEN (dev only). Set a 16+ char key for any networked deploy.')
  }
  if ((process.env.POWERSYNC_JWT_SECRET ?? '').length < 32) {
    console.warn('[auth] POWERSYNC_JWT_SECRET missing/short — PowerSync tokens use an insecure dev default.')
  }
}

function providedKey(req: Request): string {
  const header = req.headers['x-api-key']
  if (typeof header === 'string' && header.length > 0) return header
  const auth = req.headers.authorization ?? ''
  // Accept `Bearer <key>` only when it matches the API key; the PowerSync
  // token endpoint carries identity in Bearer separately (see index.ts).
  if (auth.startsWith('Bearer ') && apiKeyConfigured() && auth.slice(7) === process.env.SYNC_API_KEY) {
    return auth.slice(7)
  }
  return typeof header === 'string' ? header : ''
}

/** 401 when a key is configured and the request lacks it. Open in dev. */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!apiKeyConfigured()) {
    next()
    return
  }
  if (providedKey(req) === process.env.SYNC_API_KEY) {
    next()
    return
  }
  res.status(401).json({ error: 'Unauthorized: valid X-API-Key required' })
}
