import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'

/** Performance réelle des transporteurs chez vous (180 jours). */
export function CarrierScorecards() {
  const { data: cards } = useSuspenseQuery(convexQuery(api.carriers.scorecards, {}))
  return (
    <div className="card" style={{ marginTop: '14px' }}>
      <div className="card-title">
        Transporteurs <span className="card-tag">historique réel · 180 jours</span>
      </div>
      {cards.length === 0 ? (
        <div className="empty-state">
          Aucun historique : affectez des camions (flotte fleet-hub) ou retenez des transporteurs via FleetMarket.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Transporteur</th><th>Courses</th><th>À l&apos;heure</th><th>Retard moyen</th><th>Incidents retard</th><th>Conformité fleet-hub</th></tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.key}>
                <td>{c.name}</td>
                <td className="mono">{c.shipments}</td>
                <td className="mono" style={{ color: c.onTimeRate === null ? undefined : c.onTimeRate >= 90 ? 'var(--accent)' : c.onTimeRate >= 75 ? 'var(--amber)' : 'var(--red)' }}>
                  {c.onTimeRate === null ? '—' : `${c.onTimeRate}% (${c.onTime}/${c.delivered})`}
                </td>
                <td className="mono">{c.avgDelayMin === null ? '—' : `${c.avgDelayMin} min`}</td>
                <td className="mono">{c.delayIncidents}</td>
                <td className="mono">{c.lastComplianceScore !== undefined ? `${c.lastComplianceScore}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
