import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'

export const Route = createFileRoute('/_layout/')({
  head: () => ({ meta: [{ title: 'Vue d\'ensemble — Logistix' }] }),
  component: Dashboard,
})

function Dashboard() {
  const { data: stats } = useSuspenseQuery(convexQuery(api.shipments.dashboardStats, {}))
  const { data: shipments } = useSuspenseQuery(convexQuery(api.shipments.list, { limit: 5 }))
  const { data: incidents } = useSuspenseQuery(convexQuery(api.incidents.list, { status: "open" }))

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
        <div className="page-sub">Semaine 11 — 10 au 16 mars 2026 · Réseau Europe</div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi green">
          <div className="kpi-label">Colis en transit</div>
          <div className="kpi-value">{stats.inTransit}</div>
          <div className="kpi-delta up">↑ +312 vs hier</div>
        </div>
        <div className="kpi blue">
          <div className="kpi-label">Taux livraison J+1</div>
          <div className="kpi-value">{stats.onTimeRate}%</div>
          <div className="kpi-delta up">↑ +2.1% ce mois</div>
        </div>
        <div className="kpi amber">
          <div className="kpi-label">Retards actifs</div>
          <div className="kpi-value">{stats.activeDelays}</div>
          <div className="kpi-delta warn">↔ stable (+3)</div>
        </div>
        <div className="kpi red">
          <div className="kpi-label">Incidents ouverts</div>
          <div className="kpi-value">{stats.openIncidents}</div>
          <div className="kpi-delta down">↑ +5 depuis 6h</div>
        </div>
      </div>

      {/* Grid 2 columns */}
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            Expéditions actives <span className="card-tag">Temps réel</span>
          </div>
          <div className="shipment-list">
            {(shipments.length > 0 ? shipments : [
              { _id: '1', reference: '#EX-00412', fromHubId: 'lyon', toHubId: 'bcn', status: 'in_transit', weight: 2840, customerName: 'Lyon → Barcelone' },
              { _id: '2', reference: '#EX-00409', fromHubId: 'paris', toHubId: 'ams', status: 'delivered', weight: 620, customerName: 'Paris → Amsterdam' },
              { _id: '3', reference: '#EX-00407', fromHubId: 'mrs', toHubId: 'mil', status: 'delayed', weight: 4100, customerName: 'Marseille → Milan' },
              { _id: '4', reference: '#EX-00405', fromHubId: 'bor', toHubId: 'mad', status: 'pending', weight: 980, customerName: 'Bordeaux → Madrid' },
              { _id: '5', reference: '#EX-00401', fromHubId: 'lif', toHubId: 'bru', status: 'in_transit', weight: 310, customerName: 'Lille → Bruxelles' },
            ]).map((s: any) => (
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
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="card">
            <div className="card-title">
              Alertes critiques <span className="card-tag">{incidents.length} ouvertes</span>
            </div>
            <div className="alert-list">
              {(incidents.length > 0 ? incidents : [
                { _id: '1', type: 'breakdown', severity: 'critical', title: 'Rupture frigorifique', description: 'Camion #TK-228, A7 sens nord. Sonde à +12°C depuis 40 min.', status: 'open' },
                { _id: '2', type: 'customs', severity: 'high', title: 'Retard douane', description: '3 palettes bloquées à Hendaye depuis 6h. Dossier incomplet.', status: 'open' },
                { _id: '3', type: 'capacity', severity: 'medium', title: 'Entrepôt Lyon-Sud', description: 'Capacité à 92%. Redirection recommandée vers Lyon-Nord.', status: 'open' },
              ]).map((a: any) => (
                <div key={a._id} className={`alert-item ${a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warn' : 'info'}`}>
                  <div className={`alert-dot ${a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warn' : 'info'}`} />
                  <div className="alert-text">
                    <strong>{a.title}</strong> — {a.description}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Activité récente</div>
            <div className="timeline">
              <div className="tl-item">
                <div className="tl-left">
                  <div className="tl-dot" style={{ background: '#00d4aa' }} />
                  <div className="tl-line" />
                </div>
                <div className="tl-content">
                  <div className="tl-event">Livraison confirmée — #EX-00409</div>
                  <div className="tl-time">14:32 · Amsterdam, NL</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-left">
                  <div className="tl-dot" style={{ background: '#f59e0b' }} />
                  <div className="tl-line" />
                </div>
                <div className="tl-content">
                  <div className="tl-event">Alerte retard déclenchée — #EX-00407</div>
                  <div className="tl-time">13:51 · A8, km 142</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-left">
                  <div className="tl-dot" style={{ background: '#3b82f6' }} />
                  <div className="tl-line" />
                </div>
                <div className="tl-content">
                  <div className="tl-event">Départ entrepôt — #EX-00412</div>
                  <div className="tl-time">12:07 · Lyon-Sud</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-left">
                  <div className="tl-dot" style={{ background: '#3d4a5c' }} />
                </div>
                <div className="tl-content">
                  <div className="tl-event">Chargement terminé — #EX-00405</div>
                  <div className="tl-time">11:20 · Bordeaux-Port</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid 3 columns */}
      <div className="grid-3">
        <div className="card">
          <div className="card-title">
            Charge par hub <span className="card-tag">7 jours</span>
          </div>
          <div className="bar-chart">
            {(stats.hubLoads.length > 0 ? stats.hubLoads : [
              { name: 'Paris CDG', load: 88, capacity: 100 },
              { name: 'Lyon-Sud', load: 92, capacity: 100 },
              { name: 'Marseille', load: 61, capacity: 100 },
              { name: 'Bordeaux', load: 47, capacity: 100 },
              { name: 'Lille', load: 75, capacity: 100 },
            ]).map((h: any, i: number) => (
              <div key={i} className="bar-row">
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
        </div>

        <div className="card">
          <div className="card-title">Routes prioritaires</div>
          <div className="route-list">
            <div>
              <div className="route-row">
                <div className="route-from">Paris</div>
                <div className="route-arrow">→</div>
                <div className="route-to">Berlin</div>
                <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#00d4aa' }}>314 exp.</div>
              </div>
              <div style={{ margin: '4px 0 8px' }}>
                <div className="route-bar-mini" style={{ width: '90%' }} />
              </div>
            </div>
            <div>
              <div className="route-row">
                <div className="route-from">Lyon</div>
                <div className="route-arrow">→</div>
                <div className="route-to">Milan</div>
                <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#00d4aa' }}>247 exp.</div>
              </div>
              <div style={{ margin: '4px 0 8px' }}>
                <div className="route-bar-mini" style={{ width: '72%', background: '#3b82f6' }} />
              </div>
            </div>
            <div>
              <div className="route-row">
                <div className="route-from">Marseille</div>
                <div className="route-arrow">→</div>
                <div className="route-to">Barcelone</div>
                <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#f59e0b' }}>198 exp.</div>
              </div>
              <div style={{ margin: '4px 0 8px' }}>
                <div className="route-bar-mini" style={{ width: '58%', background: '#f59e0b' }} />
              </div>
            </div>
            <div>
              <div className="route-row">
                <div className="route-from">Lille</div>
                <div className="route-arrow">→</div>
                <div className="route-to">Amsterdam</div>
                <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#00d4aa' }}>162 exp.</div>
              </div>
              <div style={{ margin: '4px 0 0' }}>
                <div className="route-bar-mini" style={{ width: '47%' }} />
              </div>
            </div>
          </div>
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