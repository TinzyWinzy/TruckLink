import {
  PowerSyncDatabase,
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  type CrudBatch
} from '@powersync/web'
import { AppSchema } from './schema'

export interface AppSyncCredentials extends PowerSyncCredentials {
  endpoint: string
  token: string
}

export class AppBackendConnector implements PowerSyncBackendConnector {
  private backendUrl: string
  private token: string | null = null
  private tokenProvider: () => Promise<string | null>

  constructor(
    backendUrl: string = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000',
    tokenProvider?: () => Promise<string | null>,
  ) {
    this.backendUrl = backendUrl
    // Identity comes from a fresh Firebase ID token (Bearer) — the old shared
    // X-API-Key shipped in the bundle and is no longer accepted (H1).
    this.tokenProvider = tokenProvider ?? (async () => null)
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...extra,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    }
  }

  setToken(token: string | null) {
    this.token = token
  }

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const powersyncUrl = import.meta.env.VITE_POWERSYNC_URL
    if (!powersyncUrl) {
      return null
    }

    try {
      const idToken = this.token ?? (await this.tokenProvider()) ?? null
      if (!idToken) {
        // No signed-in Firebase user yet — no sync until identity exists.
        return null
      }
      const facilityId = (import.meta.env.VITE_FACILITY_ID as string | undefined) ?? 'demo-facility'
      const res = await fetch(
        `${this.backendUrl}/api/auth/powersync-token?facilityId=${encodeURIComponent(facilityId)}`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      )
      if (!res.ok) {
        return null
      }
      const data = await res.json()
      return {
        endpoint: data.endpoint || powersyncUrl,
        token: data.token
      }
    } catch {
      return null
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const batch: CrudBatch | null = await database.getCrudBatch()
    if (!batch) return

    try {
      const res = await fetch(`${this.backendUrl}/api/sync/upload`, {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ batch: batch.crud })
      })

      if (res.ok) {
        await batch.complete()
      } else {
        throw new Error(`Upload failed with status ${res.status}`)
      }
    } catch (error) {
      console.warn('[PowerSync] Offline / Upload deferred:', error)
      throw error
    }
  }
}

/**
 * In-memory Mock DB for Node.js/Vitest test environments where Web Worker is unavailable.
 */
class InMemoryTestDB {
  private tables: Map<string, Map<string, any>> = new Map()

  constructor() {
    this.reset()
  }

  reset() {
    this.tables = new Map([
      ['queue_entries', new Map()],
      ['docks', new Map()],
      ['compliance_checks', new Map()],
      ['audit_logs', new Map()],
      ['alerts', new Map()],
      ['facilities', new Map()],
      ['equipment', new Map()],
      ['users', new Map()]
    ])
  }

  async init() {
    return Promise.resolve()
  }

  async execute(sql: string, params: any[] = []): Promise<any> {
    const s = sql.trim().toUpperCase()

    if (s.startsWith('DELETE FROM')) {
      const tableName = sql.trim().split(/\s+/)[2].toLowerCase()
      if (this.tables.has(tableName)) {
        this.tables.get(tableName)!.clear()
      }
      return { rowsAffected: 1 }
    }

    if (s.startsWith('INSERT INTO')) {
      const match = sql.match(/INSERT\s+INTO\s+([a-zA-Z_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i)
      if (match) {
        const table = match[1].toLowerCase()
        const cols = match[2].split(',').map((c) => c.trim().toLowerCase())
        const row: any = {}
        cols.forEach((col, idx) => {
          row[col] = params[idx]
        })
        const id = row.id || `gen-${Date.now()}`
        if (!this.tables.has(table)) {
          this.tables.set(table, new Map())
        }
        this.tables.get(table)!.set(id, row)
      }
      return { rowsAffected: 1 }
    }

    if (s.startsWith('UPDATE')) {
      const match = sql.match(/UPDATE\s+([a-zA-Z_]+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i)
      if (match) {
        const table = match[1].toLowerCase()
        const setClause = match[2]
        const whereClause = match[3]

        const targetMap = this.tables.get(table)
        if (targetMap) {
          let id = params.length > 0 ? params[params.length - 1] : undefined
          const idLiteralMatch = whereClause.match(/ID\s*=\s*['"]?([^'"\s]+)['"]?/i)
          if (idLiteralMatch && idLiteralMatch[1] !== '?') {
            id = idLiteralMatch[1]
          }

          let target = id ? targetMap.get(id) : undefined
          if (!target && id) {
            for (const [, val] of targetMap) {
              if (val.id === id) {
                target = val
                break
              }
            }
          }

          if (target) {
            const setParts = setClause.split(',').map((p) => p.trim())
            let paramIdx = 0
            for (const part of setParts) {
              const [rawCol, rawVal] = part.split('=').map((x) => x.trim())
              const colName = rawCol.toLowerCase().replace(/"/g, '')
              if (rawVal === '?') {
                target[colName] = params[paramIdx++]
              } else if (rawVal.startsWith("'") && rawVal.endsWith("'")) {
                target[colName] = rawVal.slice(1, -1)
              } else if (rawVal.toUpperCase() === 'NULL') {
                target[colName] = null
              } else if (!isNaN(Number(rawVal))) {
                target[colName] = Number(rawVal)
              } else {
                target[colName] = rawVal
              }
            }
          }
        }
      }
      return { rowsAffected: 1 }
    }

    return { rowsAffected: 0 }
  }

  async getOptional<T>(sql: string, params: any[] = []): Promise<T | null> {
    const all = await this.getAll<T>(sql, params)
    return all.length > 0 ? all[0] : null
  }

  async getAll<T>(sql: string, params: any[] = []): Promise<T[]> {
    const s = sql.trim().toUpperCase()
    const fromMatch = sql.match(/FROM\s+([a-zA-Z_]+)/i)
    if (!fromMatch) return []
    const table = fromMatch[1].toLowerCase()
    let rows = Array.from(this.tables.get(table)?.values() || [])

    // Simple WHERE filtering
    if (s.includes('WHERE ID =') || s.includes('WHERE ID=')) {
      const idParam = params[0]
      const idMatch = sql.match(/ID\s*=\s*['"]?([^'"\s]+)['"]?/i)
      const id = idParam !== undefined ? idParam : (idMatch ? idMatch[1] : undefined)
      if (id !== undefined) {
        rows = rows.filter((r) => r.id === id)
      }
    } else if (s.includes('WHERE FACILITY_ID =') || s.includes('WHERE FACILITY_ID=')) {
      const facId = params[0]
      if (facId !== undefined) {
        rows = rows.filter((r) => r.facility_id === facId)
      }
    }

    if (s.includes('ORDER BY TIMESTAMP DESC')) {
      rows = rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    }

    return rows as T[]
  }

  async writeTransaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return cb(this)
  }
}

let dbInstance: any = null
let connectorInstance: AppBackendConnector | null = null

export function getPowerSyncDb(): PowerSyncDatabase {
  if (!dbInstance) {
    if (typeof Worker === 'undefined') {
      // In Vitest / Node test runner, provide in-memory database mock
      dbInstance = new InMemoryTestDB() as any
    } else {
      dbInstance = new PowerSyncDatabase({
        schema: AppSchema,
        database: {
          dbFilename: 'bak_opshield.db'
        }
      })
    }
  }
  return dbInstance
}

export function getBackendConnector(): AppBackendConnector {
  if (!connectorInstance) {
    connectorInstance = new AppBackendConnector(undefined, async () => {
      try {
        const { auth } = await import('../firebase')
        const user = auth?.currentUser
        return user ? user.getIdToken() : null
      } catch {
        return null
      }
    })
  }
  return connectorInstance
}

export async function initPowerSync(): Promise<PowerSyncDatabase> {
  const db = getPowerSyncDb()
  const connector = getBackendConnector()

  try {
    await db.init()
    if (import.meta.env.VITE_POWERSYNC_URL && typeof (db as any).connect === 'function') {
      await (db as any).connect(connector)
    }
  } catch (err) {
    console.warn('[PowerSync] Init warning:', err)
  }

  return db
}
