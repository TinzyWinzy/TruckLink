export type Stop = { label: string; lon: number; lat: number; kind: 'origin' | 'waypoint' | 'destination' }
export type Position = { lon: number; lat: number; timestamp: string; source: string; accuracy: number | null; age_seconds: number; stale: boolean }
export type Routing = { stops: Stop[]; geometry: { type: 'LineString'; coordinates: number[][] } | null; distance_km: number | null; duration_hours: number | null; provider: string; jurisdictions: string[]; route_type?: string; generated_at?: string; regulatory_clearance: string }
export type RouteTrip = { id: number; origin: string; destination: string; status: string; synthetic: boolean; vehicle: { id: number; plate: string } | null; driver: { id: number; name: string } | null; routing: Routing; position: Position | null; context: { id: number; queue_entry: string; route_type: string; jurisdictions: string[]; latest_decision: string | null; attempt_id: number | null; rulesets: { id: number; digest: string }[] } | null }
export type RouteWorkspace = { trips: RouteTrip[]; vehicles: { id: number; plate: string }[]; drivers: { id: number; name: string }[]; can_save: boolean; facility: { id: number; name: string }; organisation: { id: number; name: string } }

export function syntheticRoutes(): RouteTrip[] {
  const make = (id: number, labels: string[], coordinates: number[][], codes: string[], position: Position | null): RouteTrip => ({
    id, origin: labels[0], destination: labels[labels.length-1], status: 'SYNTHETIC', synthetic: true,
    vehicle: { id, plate: `SYN-${id}` }, driver: null, context: null, position,
    routing: { stops: coordinates.map(([lon, lat], i) => ({ label: labels[i], lon, lat, kind: i === 0 ? 'origin' : i === labels.length-1 ? 'destination' : 'waypoint' })),
      geometry: { type: 'LineString', coordinates }, distance_km: null, duration_hours: null,
      provider: 'Invented stop connections, not a road route', jurisdictions: codes,
      route_type: codes.length > 1 ? 'CROSS_BORDER' : 'DOMESTIC', regulatory_clearance: 'NOT_EVALUATED' },
  })
  return [
    make(9001, ['Harare, Zimbabwe','Beitbridge, Zimbabwe','Johannesburg, South Africa'], [[31.052,-17.825],[29.99,-22.216],[28.047,-26.204]], ['ZW','ZA'], { lon: 30.7, lat: -19.5, timestamp: '2026-01-01T10:00:00Z', source: 'SYNTHETIC', accuracy: null, age_seconds: 3600, stale: true }),
    make(9002, ['Harare, Zimbabwe','Mutare, Zimbabwe'], [[31.052,-17.825],[32.67,-18.97]], ['ZW'], null),
  ]
}
