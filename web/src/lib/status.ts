/** Branded status language — shape + text, never color-only. */
export function statusPillClass(status: string): string {
  const s = status.toUpperCase()
  if (/(REVIEW_REQUIRED|HOLD|BLOCKED|QUARANTINED|FAIL|CRITICAL)/.test(s)) return 'pill pill-fail'
  if (/(WARN|PENDING_OVERRIDE|OVERRIDE_APPROVED)/.test(s)) return 'pill pill-warn'
  if (/(PASS|RELEASED|AVAILABLE|RESOLVED|ACKNOWLEDGED|STABLE|ONLINE|LIVE)/.test(s)) return 'pill pill-pass'
  if (/(FAIL|QUARANTINED|CRITICAL|OFFLINE|OVERDUE|MAINTENANCE)/.test(s)) return 'pill pill-fail'
  if (/(PENDING|QUEUED|ASSIGNED|LOADING|ACTIVE|HIGH|SYNC|OFFLINE)/.test(s)) return 'pill pill-queued'
  if (/(WARN|MEDIUM|RESERVED|DEMO|STALE)/.test(s)) return 'pill pill-warn'
  return 'pill pill-neutral'
}
