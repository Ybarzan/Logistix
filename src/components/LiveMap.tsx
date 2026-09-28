import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type * as Leaflet from 'leaflet'
import type { LayerGroup, Map as LeafletMap } from 'leaflet'

export type MapHub = { id: string; lat: number; lng: number; label: string; loadPct?: number; muted?: boolean }
export type MapTruck = { id: string; lat: number; lng: number; label: string; href?: string; stale?: boolean }

type Props = {
  hubs?: Array<MapHub>
  trucks?: Array<MapTruck>
  /** Trace GPS (ordre chronologique). */
  trail?: Array<[number, number]>
  /** Segment départ → arrivée prévu. */
  plannedLine?: [[number, number], [number, number]]
  height?: number
}

// Tuiles OSM standard (sans clé), assombries en CSS pour le thème sombre.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function hubColor(h: MapHub): string {
  if (h.muted) return '#56627e'
  if ((h.loadPct ?? 0) > 90) return '#ff5f6d'
  if ((h.loadPct ?? 0) > 75) return '#ffb547'
  return '#5b8cff'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/**
 * Carte temps réel (Leaflet, chargé côté client uniquement : SSR sans
 * `window`). Les couches sont redessinées à chaque mise à jour des
 * données Convex ; le cadrage n'est calculé qu'au premier affichage pour
 * ne pas « sauter » sous les yeux de l'opérateur à chaque position reçue.
 */
export function LiveMap({ hubs = [], trucks = [], trail = [], plannedLine, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const fittedRef = useRef(false)
  const leafletRef = useRef<typeof Leaflet | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? mod
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map)
      map.setView([46.6, 2.4], 5)
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)
      draw()
    })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      fittedRef.current = false
    }
  }, [])

  useEffect(() => {
    draw()
  }, [hubs, trucks, trail, plannedLine])

  function draw() {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer) return
    layer.clearLayers()
    const points: Array<[number, number]> = []

    if (plannedLine) {
      L.polyline(plannedLine, { color: '#56627e', weight: 2, dashArray: '6 6' }).addTo(layer)
    }
    if (trail.length > 1) {
      L.polyline(trail, { color: '#1fe0b8', weight: 3, opacity: 0.7 }).addTo(layer)
    }
    for (const h of hubs) {
      points.push([h.lat, h.lng])
      L.circleMarker([h.lat, h.lng], {
        radius: 7,
        color: hubColor(h),
        weight: 2,
        fillColor: hubColor(h),
        fillOpacity: 0.35,
      })
        .bindTooltip(`${escapeHtml(h.label)}${h.loadPct !== undefined ? ` · ${h.loadPct}%` : ''}`)
        .addTo(layer)
    }
    for (const t of trucks) {
      points.push([t.lat, t.lng])
      const color = t.stale ? '#ffb547' : '#1fe0b8'
      const marker = L.circleMarker([t.lat, t.lng], {
        radius: 8,
        color,
        weight: 3,
        fillColor: color,
        fillOpacity: 0.9,
        className: t.stale ? '' : 'truck-pulse',
      }).bindTooltip(escapeHtml(t.label), { permanent: trucks.length <= 3, direction: 'top' })
      if (t.href) {
        const href = t.href
        marker.on('click', () => {
          window.location.assign(href)
        })
      }
      marker.addTo(layer)
    }

    if (!fittedRef.current && points.length > 0) {
      if (points.length === 1) map.setView(points[0], 11)
      else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 12 })
      fittedRef.current = true
    }
  }

  return <div ref={containerRef} className="live-map" style={{ height }} />
}
