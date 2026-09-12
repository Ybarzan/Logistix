import { Link, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { eventColors, formatDateTime } from '../../components/shipmentMeta'

export const Route = createFileRoute('/_layout/tracabilite')({
  head: () => ({ meta: [{ title: 'Traçabilité — Logistix' }] }),
  component: TracingPage,
})

const eventLabels: Record<string, string> = {
  created: 'Créée',
  processed: 'Traitée',
  in_transit: 'En transit',
  delayed: 'Retard',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  custom: 'Suivi',
}

function TracingPage() {
  const { data: events } = useSuspenseQuery(convexQuery(api.tracking.recent, {}))
  const [query, setQuery] = useState('')

  const filtered = events.filter((event) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [event.reference, event.fromCity, event.toCity, event.location ?? '', event.description]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })

  return (
    <>
      <div className="page-header">
        <div className="page-title">Traçabilité</div>
        <div className="page-sub">Flux d'événements en temps réel · {events.length} événements</div>
      </div>

      <div className="toolbar">
        <input
          className="searchbox"
          placeholder="Filtrer par référence, ville, localisation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun événement ne correspond. Vérifiez que le seed a été exécuté.</div>
        ) : (
          filtered.map((event) => (
            <div key={event._id} className="feed-item">
              <div className="feed-dot" style={{ background: eventColors[event.eventType] || '#3d4a5c' }} />
              <div className="feed-body">
                <div className="feed-title">
                  <Link
                    to="/expeditions/$shipmentId"
                    params={{ shipmentId: event.shipmentId }}
                    style={{ color: '#3b82f6', fontFamily: "'DM Mono', monospace", fontSize: '12px' }}
                  >
                    {event.reference}
                  </Link>
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: "'DM Mono', monospace",
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: `${eventColors[event.eventType] || '#3d4a5c'}18`,
                      color: eventColors[event.eventType] || '#3d4a5c',
                    }}
                  >
                    {eventLabels[event.eventType]}
                  </span>
                </div>
                <div className="feed-desc">{event.description}</div>
                <div className="feed-meta">
                  <span>{event.fromCity} → {event.toCity}</span>
                  <span>{formatDateTime(event._creationTime)}</span>
                  {event.location ? <span>{event.location}</span> : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}