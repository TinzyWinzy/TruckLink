import { useState, useEffect } from 'react'
import { getPowerSyncDb } from './powersync'

/**
 * Reactive React hook to watch local SQLite queries via PowerSync.
 * Automatically re-renders whenever underlying tables change.
 */
export function usePowerSyncQuery<T = any>(
  sql: string,
  parameters: any[] = []
): { data: T[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const paramsKey = JSON.stringify(parameters)

  useEffect(() => {
    let isMounted = true
    const db = getPowerSyncDb()
    const parsedParams: any[] = JSON.parse(paramsKey)

    async function loadInitial() {
      try {
        const rows = await db.getAll<T>(sql, parsedParams)
        if (isMounted) {
          setData(rows)
          setLoading(false)
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err)
          setLoading(false)
        }
      }
    }

    loadInitial()

    // Watch query stream
    const abortController = new AbortController()
    async function startWatch() {
      try {
        for await (const result of db.watch(sql, parsedParams, { signal: abortController.signal })) {
          if (!isMounted) break
          setData((result as any).rows?._array ?? (Array.isArray(result) ? (result as T[]) : []))
          setLoading(false)
        }
      } catch (err: any) {
        if (isMounted && !abortController.signal.aborted) {
          console.warn('[PowerSync watch fallback to poll]', err)
        }
      }
    }

    startWatch()

    return () => {
      isMounted = false
      abortController.abort()
    }
  }, [sql, paramsKey])

  return { data, loading, error }
}
