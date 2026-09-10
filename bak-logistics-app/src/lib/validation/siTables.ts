// S.I. 129/2015 + S.I. 159/2022 corridor-scoped axle limit tables (Phase 3).
//
// Values below are PILOT DEFAULTS — BAK to confirm against the VID schedule
// per corridor before prod. Limits are data, not law: the authoritative source
// is Firestore `complianceConfig/default` (siTablesByRoute), editable without
// a redeploy. This module is the offline fallback + pure resolver (unit-tested).
//
// Resolution order for (route, vehicleType):
//   1. remote route table  siTablesByRoute[ROUTE][VEHICLE]
//   2. remote route default siTablesByRoute[ROUTE].DEFAULT
//   3. remote global table  siTables[VEHICLE] (legacy flat shape)
//   4. remote global default siTables.DEFAULT / axleLimits.default
//   5. bundled pilot default below (same chain)

export const SI_ROUTES = [
  'BEITBRIDGE',
  'CHIRUNDU',
  'FORBES',
  'HARARE_LOCAL',
  'DEFAULT',
] as const

export type SiRoute = (typeof SI_ROUTES)[number]

export const SI_VEHICLES = [
  'DEFAULT',
  'FLATBED',
  'TANKER',
  'REFRIGERATED',
  'CONTAINER',
  'DRY_VAN',
] as const

export type SiVehicle = (typeof SI_VEHICLES)[number]

export const SI_ROUTE_LABELS: Record<SiRoute, string> = {
  BEITBRIDGE: 'Beitbridge corridor (SA)',
  CHIRUNDU: 'Chirundu corridor (ZM)',
  FORBES: 'Forbes / Mutare corridor (MZ)',
  HARARE_LOCAL: 'Harare local',
  DEFAULT: 'Default (unassigned route)',
}

/** Pilot 3-axle defaults per corridor. Identical values until BAK/VID confirms
 *  corridor-specific schedules — the structure is what Phase 3 delivers. */
const PILOT_3AXLE: Record<SiVehicle, [number, number, number]> = {
  DEFAULT: [8000, 9000, 9000],
  FLATBED: [8000, 9000, 9000],
  TANKER: [8000, 8000, 9000],
  REFRIGERATED: [7500, 9000, 9000],
  CONTAINER: [8000, 9000, 9000],
  DRY_VAN: [8000, 9000, 9000],
}

export const DEFAULT_SI_TABLES_BY_ROUTE: Record<SiRoute, Record<string, number[]>> = {
  BEITBRIDGE: { ...PILOT_3AXLE },
  CHIRUNDU: { ...PILOT_3AXLE },
  FORBES: { ...PILOT_3AXLE },
  HARARE_LOCAL: { ...PILOT_3AXLE },
  DEFAULT: { ...PILOT_3AXLE },
}

export const FALLBACK_AXLE_LIMITS: [number, number, number] = [8000, 9000, 9000]

export function normalizeRoute(route: string | undefined | null): SiRoute {
  const key = (route ?? 'DEFAULT').toUpperCase()
  return (SI_ROUTES as readonly string[]).includes(key) ? (key as SiRoute) : 'DEFAULT'
}

export function normalizeVehicle(vehicle: string | undefined | null): string {
  const key = (vehicle ?? 'DEFAULT').toUpperCase()
  return key || 'DEFAULT'
}

export interface SiRemoteConfig {
  /** New shape: per-route tables. */
  siTablesByRoute?: Record<string, Record<string, number[]>>
  /** Legacy flat shape: per-vehicle tables (treated as DEFAULT route). */
  siTables?: Record<string, number[]>
  axleLimits?: { default?: number[] }
}

/**
 * Resolve axle limits for a (route, vehicle) pair. Pure — safe offline.
 */
export function resolveSiLimits(
  route: string | undefined | null,
  vehicle: string | undefined | null,
  remote?: SiRemoteConfig,
): number[] {
  const r = normalizeRoute(route)
  const v = normalizeVehicle(vehicle)

  const byRoute = remote?.siTablesByRoute?.[r]
  if (byRoute?.[v]?.length) return byRoute[v]
  if (byRoute?.DEFAULT?.length) return byRoute.DEFAULT

  const flat = remote?.siTables
  if (flat?.[v]?.length) return flat[v]
  if (flat?.DEFAULT?.length) return flat.DEFAULT

  if (remote?.axleLimits?.default?.length) return remote.axleLimits.default

  const bundled = DEFAULT_SI_TABLES_BY_ROUTE[r]
  if (bundled?.[v]?.length) return bundled[v]
  if (bundled?.DEFAULT?.length) return bundled.DEFAULT

  return [...FALLBACK_AXLE_LIMITS]
}
