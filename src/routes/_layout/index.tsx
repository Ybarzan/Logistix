import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import { eventColors, formatDateTime } from '../../components/shipmentMeta'

export const Route = createFileRoute('/_layout/')({
  head: () => ({ meta: [{ title: 'Vue d\'ensemble — Logistix' }] }),
  component: Dashboard,
})

function Dashboard() {
  const { data: stats } = useSuspenseQuery(convexQuery(api.shipments.dashboardStats, {}))
  const { data: shipments } = useSuspenseQuery(convexQuery(api.shipments.list, { limit: 5 }))
  const { data: incidents } = useSuspenseQuery(convexQuery(api.incidents.list, { status: "open" }))
  const { data: recentEvents } = useSuspenseQuery(convexQuery(api.tracking.recent, { limit: 5 }))

  const statusLabels: Record<string, string> = {
    pending: 'En attente',
    loading: 'Chargement',
    in_transit: 'Transit',
    delivered: 'Livré',
    delayed: 'Retard',
    cancelled: 'Annulé',
  }

  const statusClasses: Record<string, string> = {
    pending: 'pending',
    loading: 'transit',
    in_transit: 'transit',
    delivered: 'delivered',
    delayed: 'delayed',
    cancelled: 'delayed',
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">Vue d'ensemble opérationnelle</div>
        <div className="page-sub">
          {stats.inTransit} colis en transit · {incidents.length} alerte(s) ouverte(s)
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi green">
          <div className="kpi-label">Colis en transit</div>
          <div className="kpi-value">{stats.inTransit}</div>
          <div className="kpi-delta up">en temps réel</div>
        </div>
        <div className="kpi blue">
          <div className="kpi-label">Taux livraison J+1</div>
          <div className="kpi-value">{stats.onTimeRate}%</div>
          <div className="kpi-delta up">sur 7 jours</div>
        </div>
        <div className="kpi amber">
          <div className="kpi-label">Retards actifs</div>
          <div className="kpi-value">{stats.activeDelays}</div>
          <div className="kpi-delta warn">à surveiller</div>
        </div>
        <div className="kpi red">
          <div className="kpi-label">Incidents ouverts</div>
          <div className="kpi-value">{stats.openIncidents}</div>
          <div className="kpi-delta down">à traiter</div>
        </div>
      </div>

      {/* Grid 2 columns */}
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            Expéditions actives <span className="card-tag">Temps réel</span>
          </div>
          {shipments.length === 0 ? (
            <div className="empty-state">Aucune expédition en cours.</div>
          ) : (
            <div className="shipment-list">
              {shipments.map((s) => (
                <div key={s._id} className="shipment-row">
                  <div className="ship-id">{s.reference}</div>
                  <div className="ship-dest">{s.customerName}</div>
                  <div className="ship-weight">{s.weight.toLocaleString()} kg</div>
                  <div className={`status-pill ${statusClasses[s.status] || 'transit'}`}>
                    {statusLabels[s.status] || s.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="card">
            <div className="card-title">
              Alertes critiques <span className="card-tag">{incidents.length} ouvertes</span>
            </div>
            {incidents.length === 0 ? (
              <div className="empty-state">Aucune alerte ouverte.</div>
            ) : (
              <div className="alert-list">
                {incidents.map((a) => (
                  <div key={a._id} className={`alert-item ${a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warn' : 'info'}`}>
                    <div className={`alert-dot ${a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warn' : 'info'}`} />
                    <div className="alert-text">
                      <strong>{a.title}</strong> — {a.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Activité récente</div>
            {recentEvents.length === 0 ? (
              <div className="empty-state">Aucune activité récente.</div>
            ) : (
              <div className="timeline">
                {recentEvents.map((event, i) => (
                  <div key={event._id} className="tl-item">
                    <div className="tl-left">
                      <div className="tl-dot" style={{ background: eventColors[event.eventType] || '#3d4a5c' }} />
                      {i < recentEvents.length - 1 && <div className="tl-line" />}
                    </div>
                    <div className="tl-content">
                      <div className="tl-event">{event.description}</div>
                      <div className="tl-time">
                        {formatDateTime(event._creationTime)} · {event.fromCity} → {event.toCity}
                        {event.location ? ` · ${event.location}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid 3 columns */}
      <div className="grid-3">
        <div className="card">
          <div className="card-title">
            Charge par hub <span className="card-tag">7 jours</span>
          </div>
          {stats.hubLoads.length === 0 ? (
            <div className="empty-state">Aucune donnée de charge.</div>
          ) : (
            <div className="bar-chart">
              {stats.hubLoads.map((h) => (
                <div key={h.hubId} className="bar-row">
                  <div className="bar-label">{h.name}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{
                      width: `${h.load}%`,
                      background: h.load > 85 ? '#f59e0b' : h.load > 70 ? '#3b82f6' : '#00d4aa'
                    }} />
                  </div>
                  <div className="bar-val">{h.load}%</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Routes prioritaires</div>
          <div className="empty-state">Aucune route prioritaire pour l'instant.</div>
        </div>

        <div className="card">
          <div className="card-title">SLA cette semaine</div>
          <div className="gauge-wrap">
            <svg className="gauge-svg" viewBox="0 0 120 70">
              <path d="M15 65 A50 50 0 0 1 105 65" fill="none" stroke="#1a2135" strokeWidth="10" strokeLinecap="round"/>
              <path d="M15 65 A50 50 0 0 1 105 65" fill="none" stroke="#00d4aa" strokeWidth="10" strokeLinecap="round" strokeDasharray="157" strokeDashoffset="22"/>
            </svg>
            <div className="gauge-pct">{stats.slaRate}%</div>
            <div className="gauge-label">SLA respecté</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px', borderTop: '1px solid #1e2535', paddingTop: '14px' }}>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '18px', color: '#00d4aa' }}>{stats.onTime}</div>
              <div className="mini-label">Dans les délais</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '18px', color: '#ef4444' }}>{stats.late}</div>
              <div className="mini-label">Hors délai</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}