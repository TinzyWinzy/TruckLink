// Adapted from SpotterAiAssessment RouteMap / LiveMapPage: Leaflet, stop and position layers.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { RouteTrip } from '../lib/routes'

export default function RouteMap({ trips, selectedId, onSelect }: { trips: RouteTrip[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const routeBounds = useRef<L.LatLngBounds | null>(null)
  const [tileError, setTileError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [expanded])
  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, { scrollWheelZoom: false, fadeAnimation: false }).setView([-19, 29], 5)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance)
    tiles.on('tileerror', () => setTileError(true))
    layer.current = L.layerGroup().addTo(instance)
    L.control.scale({ imperial: false }).addTo(instance)
    map.current = instance
    const resize = new ResizeObserver(() => {
      instance.invalidateSize()
      if (routeBounds.current?.isValid()) instance.fitBounds(routeBounds.current, { padding: [40,40], maxZoom: 11, animate: false })
    })
    resize.observe(container.current)
    return () => { resize.disconnect(); instance.remove(); map.current = null; layer.current = null }
  }, [])
  useEffect(() => {
    if (!map.current || !layer.current) return
    const target = layer.current; target.clearLayers()
    const bounds = L.latLngBounds([])
    const shown = selectedId == null ? trips : trips.filter(t => t.id === selectedId)
    function tooltip(value: string) { const el = document.createElement('span'); el.textContent = value; return el }
    for (const trip of shown) {
      const raw = trip.routing.geometry?.coordinates
      const coords = Array.isArray(raw) ? raw.filter(c => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) : []
      if (coords.length >= 2) {
        const line = L.polyline(coords.map(c => [c[1],c[0]] as L.LatLngTuple), { color: '#c2570b', weight: 4, dashArray: trip.synthetic ? '8 8' : undefined }).addTo(target)
        line.on('click', () => onSelect(trip.id)); bounds.extend(line.getBounds())
      }
      for (const [i, stop] of (trip.routing.stops ?? []).entries()) {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon) || Math.abs(stop.lat) > 90 || Math.abs(stop.lon) > 180) continue
        const icon = L.divIcon({ className: 'route-stop-icon', html: `<span>${i + 1}</span>`, iconSize: [44,44], iconAnchor: [22,22] })
        const marker = L.marker([stop.lat,stop.lon], { icon, title: `${i + 1}. ${stop.label}`, alt: stop.label }).addTo(target)
        marker.bindTooltip(tooltip(`${i + 1}. ${stop.label}`)); marker.on('click', () => onSelect(trip.id)); bounds.extend([stop.lat,stop.lon])
      }
      const pos = trip.position
      if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon) && Math.abs(pos.lat) <= 90 && Math.abs(pos.lon) <= 180) {
        const marker = L.circleMarker([pos.lat,pos.lon], { radius: 10, color: '#fff', weight: 3, fillOpacity: 1, fillColor: pos.stale ? '#64748b' : '#047857' }).addTo(target)
        marker.bindTooltip(tooltip(`${trip.vehicle?.plate ?? `Trip ${trip.id}`} · ${pos.source} · ${pos.stale ? 'stale report' : 'recent report'}`))
        marker.on('click', () => onSelect(trip.id)); bounds.extend([pos.lat,pos.lon])
      }
    }
    routeBounds.current = bounds.isValid() ? bounds : null
    if (bounds.isValid()) map.current.fitBounds(bounds, { padding: [40,40], maxZoom: 11, animate: false })
    else map.current.setView([-19,29],5)
  }, [trips, selectedId, onSelect])
  return <div className={expanded ? 'route-map-panel route-map-expanded' : 'route-map-panel'}>
    <div className="flex flex-wrap items-center justify-between gap-2 pb-3"><h2 className="font-semibold">Geographic evidence</h2><button type="button" className="report-text-link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Reduce map' : 'Expand map'}</button></div>
    <div ref={container} className="route-map-surface" role="region" aria-label="Route and reported position map" />
    {tileError && <p role="status" className="mt-3 text-sm">Map imagery is unavailable. Route overlays and the trip list remain usable.</p>}
    <p className="report-note">Numbered stops follow itinerary order. Grey positions are stale. Dashed lines connect invented stops; they are not road routes. Basemap: OpenStreetMap.</p>
  </div>
}
