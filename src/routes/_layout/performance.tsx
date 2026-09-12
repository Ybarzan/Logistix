import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'

export const Route = createFileRoute('/_layout/performance')({
  head: () => ({ meta: [{ title: 'Performance — Logistix' }] }),
  component: PerformancePage,
})

function PerformancePage() {
  const { data: stats } = useSuspenseQuery(convexQuery(api.stats.performanceStats, {}))
  const maxVolume = Math.max(1, ...stats.volumePerDay.map((d) => d.count))

  return (
    <>
      <div className="page-header">
        <div className="page-title">Performance du réseau</div>
        <div className="page-sub">Volumes, charge des hubs et engagement · 7 jours</div>
      </div>

      <div className="kpi-grid">
        <div className="kpi green">
          <div className="kpi-label">Colis en transit</div>
          <div className="kpi-value">{stats.inTransit.toLocaleString()}</div>
          <div className="kpi-delta up">sur le réseau</div>
        </div>
        <div className="kpi blue">
          <div className="kpi-label">Poids en transit</div>
          <div className="kpi-value">{(stats.totalWeightInTransit / 1000).toFixed(1)}t</div>
          <div className="kpi-delta">{stats.totalWeightInTransit.toLocaleString()} kg</div>
        </div>
        <div className="kpi amber">
          <div className="kpi-label">Livraison à l'heure</div>
          <div className="kpi-value">{stats.onTimeRate}%</div>
          <div className="kpi-delta warn">{stats.deliveredTotal} livrées</div>
        </div>
        <div className="kpi red">
          <div className="kpi-label">Incidents résolus</div>
          <div className="kpi-value">{stats.resolutionRate}%</div>
          <div className="kpi-delta down">{stats.openIncidents} encore ouvert(s)</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Volume d'expéditions <span className="card-tag">7 jours</span></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', height: '160px', paddingTop: '8px' }}>
            {stats.volumePerDay.map((day) => (
              <div key={day.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: day.count > 0 ? '#00d4aa' : '#3d4a5c' }}>
                  {day.count > 0 ? day.count : ''}
                </span>
                <div
                  title={`${day.label} : ${day.count} expéditions`}
                  style={{
                    width: '100%',
                    maxWidth: '38px',
                    height: `${day.count === 0 ? 4 : Math.max(6, (day.count / maxVolume) * 100)}%`,
                    background: day.count > 0 ? '#00d4aa' : '#1a2135',
                    borderRadius: '4px 4px 0 0',
                    opacity: day.count > 0 ? 0.85 : 1,
                  }}
                />
                <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c' }}>{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Charge et volume par hub</div>
          <div>
            {stats.hubThroughput.length === 0 ? (
              <div className="empty-state">Aucun hub configuré.</div>
            ) : (
              stats.hubThroughput.map((hub) => (
                <div key={hub.hubId} className="allocation-row">
                  <span className="bar-label">{hub.name}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${Math.min(100, hub.loadPct)}%`,
                        background: hub.loadPct > 85 ? '#ef4444' : hub.loadPct > 70 ? '#f59e0b' : '#00d4aa',
                      }}
                    />
                  </div>
                  <span className="bar-val">{hub.loadPct}%</span>
                </div>
              ))
            )}
          </div>
          <div className="stat-pair">
            <div className="mini-stat" style={{ textAlign: 'left', padding: 0 }}>
              <div className="mini-num" style={{ fontSize: '18px', color: '#00d4aa' }}>{stats.hubThroughput.reduce((acc, h) => acc + h.throughput, 0)}</div>
              <div className="mini-label">Expéditions liées aux hubs</div>
            </div>
            <div className="mini-stat" style={{ textAlign: 'left', padding: 0 }}>
              <div className="mini-num" style={{ fontSize: '18px', color: '#3b82f6' }}>{stats.resolvedIncidents}</div>
              <div className="mini-label">Incidents résolus</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: '14px' }}>
        <div className="card">
          <div className="card-title">Engagement SLA</div>
          <div className="gauge-wrap">
            <svg className="gauge-svg" viewBox="0 0 120 70">
              <path d="M15 65 A50 50 0 0 1 105 65" fill="none" stroke="#1a2135" strokeWidth="10" strokeLinecap="round" />
              <path
                d="M15 65 A50 50 0 0 1 105 65"
                fill="none"
                stroke="#00d4aa"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray="157"
                strokeDashoffset={String(157 - (157 * stats.onTimeRate) / 100)}
              />
            </svg>
            <div className="gauge-pct">{stats.onTimeRate}%</div>
            <div className="gauge-label">Livraison à l'heure</div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Capital incidents</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '22px', color: '#ef4444' }}>{stats.openIncidents}</div>
              <div className="mini-label">Ouverts</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '22px', color: '#00d4aa' }}>{stats.resolvedIncidents}</div>
              <div className="mini-label">Résolus</div>
            </div>
            <div className="mini-stat" style={{ gridColumn: '1 / -1' }}>
              <div className="bar-track" style={{ marginBottom: '8px' }}>
                <div
                  className="bar-fill"
                  style={{
                    width: `${stats.resolutionRate}%`,
                    background: '#00d4aa',
                  }}
                />
              </div>
              <div className="mini-label">Taux de résolution global : {stats.resolutionRate}%</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}