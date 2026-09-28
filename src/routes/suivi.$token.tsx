import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { LiveMap } from '../components/LiveMap'
import { eventColors, formatDateTime, statusClasses, statusLabels } from '../components/shipmentMeta'
import { Ambient } from '../components/Ambient'

/**
 * Suivi public destiné au client final : accessible sans compte via un
 * lien secret révocable. Données volontairement réduites (voir
 * convex/publicTracking.ts) et mises à jour en temps réel.
 */
export const Route = createFileRoute('/suivi/$token')({
  head: () => ({
    meta: [
      { title: 'Suivi de votre expédition' },
      // Lien privé : ne jamais l'indexer.
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: PublicTrackingPage,
})

const STEPS = ['pending', 'loading', 'in_transit', 'delivered'] as const

function PublicTrackingPage() {
  const { token } = Route.useParams()
  const { data } = useSuspenseQuery(convexQuery(api.publicTracking.get, { token }))

  if (!data) {
    return (
      <div className="public-shell">
        <Ambient />
        <div className="public-card">
          <div className="public-brand">Suivi d'expédition</div>
          <div className="empty-state">Ce lien de suivi n'existe pas ou a été désactivé par l'expéditeur.</div>
        </div>
      </div>
    )
  }

  const stepIndex = data.status === 'delayed' ? 2 : STEPS.indexOf(data.status as (typeof STEPS)[number])
  const cancelled = data.status === 'cancelled'

  return (
    <div className="public-shell">
        <Ambient />
      <div className="public-card">
        <div className="public-brand">{data.organizationName || "Suivi d'expédition"}</div>
        <div className="public-ref">{data.reference}</div>
        <div className="public-route">
          {data.fromCity} → {data.toCity}
        </div>
        <span className={`status-pill ${statusClasses[data.status] || 'transit'}`}>
          {statusLabels[data.status] || data.status}
        </span>

        {!cancelled && (
          <ol className="public-steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i <= stepIndex ? 'done' : ''}>
                {statusLabels[s]}
              </li>
            ))}
          </ol>
        )}

        <div className="info-list" style={{ marginTop: '16px' }}>
          {data.actualDelivery ? (
            <div className="info-row">
              <span className="info-label">Livrée le</span>
              <span className="info-value">{formatDateTime(data.actualDelivery)}</span>
            </div>
          ) : data.predictedArrival ? (
            <div className="info-row">
              <span className="info-label">Arrivée estimée (en direct)</span>
              <span className="info-value">
                {formatDateTime(data.predictedArrival.eta)}
                <div className="prediction-detail">
                  entre {new Date(data.predictedArrival.low).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} et{' '}
                  {new Date(data.predictedArrival.high).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </span>
            </div>
          ) : data.estimatedDelivery ? (
            <div className="info-row">
              <span className="info-label">Livraison prévue</span>
              <span className="info-value">{formatDateTime(data.estimatedDelivery)}</span>
            </div>
          ) : null}
          {data.approxPosition && (
            <div className="info-row">
              <span className="info-label">Dernière position</span>
              <span className="info-value">{formatDateTime(data.approxPosition.recordedAt)}</span>
            </div>
          )}
        </div>

        {data.approxPosition && (
          <div style={{ marginTop: '14px' }}>
            <LiveMap
              height={240}
              trucks={[{ id: 'truck', lat: data.approxPosition.lat, lng: data.approxPosition.lng, label: 'Votre expédition (position approximative)' }]}
            />
          </div>
        )}

        <div className="card-title" style={{ marginTop: '18px' }}>Historique</div>
        <div className="timeline">
          {data.events.map((e) => (
            <div key={`${e.at}-${e.eventType}`} className="tl-item">
              <div className="tl-left">
                <div className="tl-dot" style={{ background: eventColors[e.eventType] || 'var(--faint)', width: '9px', height: '9px' }} />
                <div className="tl-line" />
              </div>
              <div className="tl-content">
                <div className="tl-event">{e.description}</div>
                <div className="tl-time">{formatDateTime(e.at)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="public-foot">Page mise à jour en temps réel · propulsé par LogistiX</div>
      </div>
    </div>
  )
}
