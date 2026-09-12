import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'

export const Route = createFileRoute('/_layout/sla')({
  head: () => ({ meta: [{ title: 'Délais & SLA — Logistix' }] }),
  component: SLAPage,
})

function SLAPage() {
  const { data: stats } = useSuspenseQuery(convexQuery(api.stats.slaStats, {}))

  const maxReason = Math.max(1, ...stats.delaysByReason.map((r) => r.count))

  return (
    <>
      <div className="page-header">
        <div className="page-title">Délais &amp; SLA</div>
        <div className="page-sub">Performance d'engagement des délais · {stats.total} expéditions au total</div>
      </div>

      <div className="kpi-grid">
        <div className="kpi green">
          <div className="kpi-label">SLA respecté</div>
          <div className="kpi-value">{stats.slaRate}%</div>
          <div className="kpi-delta up">{stats.onTime} livraisons à l'heure</div>
        </div>
        <div className="kpi blue">
          <div className="kpi-label">Dans les délais</div>
          <div className="kpi-value">{stats.onTime.toLocaleString()}</div>
          <div className="kpi-delta up">sur {stats.statusCounts.delivered} livrées</div>
        </div>
        <div className="kpi amber">
          <div className="kpi-label">Hors délai</div>
          <div className="kpi-value">{stats.late.toLocaleString()}</div>
          <div className="kpi-delta warn">{stats.delaysByReason.length} causes actives</div>
        </div>
        <div className="kpi red">
          <div className="kpi-label">Temps moyen de transit</div>
          <div className="kpi-value">{stats.avgTransitHours !== undefined ? `${stats.avgTransitHours}h` : '—'}</div>
          <div className="kpi-delta">{stats.statusCounts.delayed} retard(s) en cours</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Répartition des retards <span className="card-tag">Par cause</span></div>
          {stats.delaysByReason.length === 0 ? (
            <div className="empty-state">Aucun retard ouvert pour l'instant.</div>
          ) : (
            <div>
              {stats.delaysByReason.map((reason) => (
                <div key={reason.type} className="allocation-row">
                  <span className="bar-label">{reason.label}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(reason.count / maxReason) * 100}%`, background: '#f59e0b' }}
                    />
                  </div>
                  <span className="bar-val">{reason.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Statut des expéditions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '20px', color: '#f59e0b' }}>{stats.statusCounts.pending}</div>
              <div className="mini-label">En attente</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '20px', color: '#3b82f6' }}>{stats.statusCounts.loading}</div>
              <div className="mini-label">Chargement</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '20px', color: '#3b82f6' }}>{stats.statusCounts.in_transit}</div>
              <div className="mini-label">En transit</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '20px', color: '#00d4aa' }}>{stats.statusCounts.delivered}</div>
              <div className="mini-label">Livrées</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '20px', color: '#ef4444' }}>{stats.statusCounts.delayed}</div>
              <div className="mini-label">Retards</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '20px', color: '#3d4a5c' }}>{stats.statusCounts.cancelled}</div>
              <div className="mini-label">Annulées</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '14px' }}>
        <div className="card-title">
          SLA par itinéraire <span className="card-tag">Livraisons terminées</span>
        </div>
        {stats.slaByRoute.length === 0 ? (
          <div className="empty-state">
            Aucune livraison terminée rattachée à un itinéraire pour l'instant.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 28px' }}>
            {stats.slaByRoute.map((route) => (
              <div key={route.routeId ?? 'default'} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#c8d0e0', fontWeight: 500 }}>{route.name}</span>
                  <span style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: route.slaRate >= 85 ? '#00d4aa' : route.slaRate >= 70 ? '#f59e0b' : '#ef4444' }}>
                    {route.slaRate}%
                  </span>
                </div>
                <div className="bar-track" style={{ marginBottom: '8px' }}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max(2, route.slaRate)}%`,
                      background: route.slaRate >= 85 ? '#00d4aa' : route.slaRate >= 70 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
                <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#4a5568' }}>
                  {route.delivered} livrées · {route.onTime} à l'heure
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}