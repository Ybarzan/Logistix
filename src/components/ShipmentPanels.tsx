import { useAction, useMutation } from 'convex/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { formatDateTime } from './shipmentMeta'
import { trackingUrl } from './RecommendedActions'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Une erreur est survenue'
  const m = raw.match(/Uncaught Error: (.+?)(\n|$)/)
  return m ? m[1] : raw
}

type Proposals = FunctionReturnType<typeof api.fleetmarket.proposals>['proposals']

const FM_STATUS: Record<string, string> = {
  OPEN: 'Publiée, en attente de transporteurs',
  MATCHED: 'Transporteur retenu',
  DONE: 'Course terminée',
  CANCELLED: 'Charge annulée',
}

/** Capacité de secours FleetMarket : publier, comparer, accepter. */
export function FleetMarketPanel({ shipment, canEdit }: { shipment: Doc<'shipments'>; canEdit: boolean }) {
  const { data: config } = useSuspenseQuery(convexQuery(api.fleetmarket.getConfig, {}))
  const { data: scorecards } = useSuspenseQuery(convexQuery(api.carriers.scorecards, {}))
  const historyOf = (carrierId?: number) =>
    carrierId === undefined ? undefined : scorecards.find((c) => c.carrierId === carrierId)
  /** Classement : historique réel chez vous (≥ 3 livraisons) d'abord, puis conformité fleet-hub. */
  const rankOf = (p: { carrierId?: number; carrierComplianceScore?: number }) => {
    const h = historyOf(p.carrierId)
    const own = h && h.delivered >= 3 && h.onTimeRate !== null ? h.onTimeRate : null
    return (own ?? -1) * 1000 + (p.carrierComplianceScore ?? -1)
  }
  const publish = useMutation(api.fleetmarket.publish)
  const fetchProposals = useAction(api.fleetmarket.proposals)
  const accept = useAction(api.fleetmarket.acceptProposal)
  const [proposals, setProposals] = useState<Proposals | null>(null)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fm = shipment.fleetmarket
  const terminal = shipment.status === 'delivered' || shipment.status === 'cancelled'

  const refresh = useCallback(() => {
    if (!fm || fm.status !== 'OPEN') return
    void fetchProposals({ shipmentId: shipment._id })
      .then((res) => {
        setProposals(res.proposals)
        setError(res.error ?? null)
      })
      .catch((err: unknown) => setError(cleanError(err)))
    // proposalCount : relire quand la synchro en signale de nouvelles.
  }, [fetchProposals, shipment._id, fm])

  useEffect(() => {
    refresh()
  }, [refresh, fm?.proposalCount])

  if (!config?.enabled && !fm) return null

  const doPublish = async () => {
    if (!window.confirm('Publier cette expédition sur FleetMarket ? Des transporteurs externes verront la charge.')) return
    setBusy(true)
    setError(null)
    try {
      await publish({
        shipmentId: shipment._id,
        ...(price.trim() ? { indicativePriceEur: Number(price) } : {}),
      })
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  const doAccept = async (proposalId: number, carrier: string) => {
    if (!window.confirm(`Retenir ${carrier} ? Les autres propositions seront déclinées.`)) return
    setBusy(true)
    setError(null)
    try {
      await accept({ shipmentId: shipment._id, proposalId })
      setProposals(null)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        Capacité FleetMarket
        {fm && <span className="card-tag">charge n°{fm.loadId}</span>}
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!fm && (
        <>
          <div className="page-sub" style={{ marginBottom: '10px' }}>
            Réseau saturé, camion en panne, retard ? Publiez la charge auprès de transporteurs dont la conformité
            est vérifiée par fleet-hub, sans commission.
          </div>
          {canEdit && !terminal && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="Prix indicatif € (optionnel)"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void doPublish()}>
                Publier
              </button>
            </div>
          )}
        </>
      )}
      {fm && (
        <div className="info-list">
          <div className="info-row">
            <span className="info-label">Statut</span>
            <span className="info-value">{FM_STATUS[fm.status] ?? fm.status}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Publiée le</span>
            <span className="info-value">{formatDateTime(fm.postedAt)}</span>
          </div>
          {fm.carrierName && (
            <div className="info-row">
              <span className="info-label">Transporteur</span>
              <span className="info-value">
                {fm.carrierName}
                {fm.carrierComplianceScore !== undefined ? ` · conformité ${fm.carrierComplianceScore}%` : ''}
              </span>
            </div>
          )}
        </div>
      )}
      {fm?.status === 'OPEN' && (
        <div style={{ marginTop: '12px' }}>
          <div className="field-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Propositions</span>
            <button type="button" className="link" onClick={refresh}>Actualiser</button>
          </div>
          {proposals === null ? (
            <div className="empty-state">Chargement…</div>
          ) : proposals.length === 0 ? (
            <div className="empty-state">Aucune proposition pour l'instant (vérifié toutes les 2 min).</div>
          ) : (
            <table className="data-table">
              <tbody>
                {proposals
                  .filter((p) => p.status === 'PROPOSED')
                  .sort((a, b) => rankOf(b) - rankOf(a))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.carrierCompanyName}
                        <div className="prediction-detail" style={{ marginLeft: 0 }}>
                          {(() => {
                            const h = historyOf(p.carrierId)
                            if (!h || h.shipments === 0) return 'Jamais travaillé avec vous'
                            return h.delivered > 0
                              ? `Chez vous : ${h.onTime}/${h.delivered} à l'heure${h.delivered < 3 ? ' (peu de recul)' : ''}`
                              : `Chez vous : ${h.shipments} course(s) en cours`
                          })()}
                        </div>
                      </td>
                      <td className="mono">
                        {p.carrierComplianceScore !== undefined ? `${p.carrierComplianceScore}%` : '—'}
                      </td>
                      <td className="mono">{p.truckRegistration ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() => void doAccept(p.id, p.carrierCompanyName)}
                          >
                            Retenir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

/** Lien de suivi public pour le client final. */
export function ClientLinkPanel({ shipment, canEdit }: { shipment: Doc<'shipments'>; canEdit: boolean }) {
  const createLink = useMutation(api.publicTracking.createLink)
  const revokeLink = useMutation(api.publicTracking.revokeLink)
  const [notice, setNotice] = useState<string | null>(null)
  const url = shipment.trackingToken ? trackingUrl(shipment.trackingToken) : null

  const copy = async (u: string) => {
    await navigator.clipboard.writeText(u).catch(() => undefined)
    setNotice('Lien copié.')
  }

  return (
    <div className="card">
      <div className="card-title">Suivi client</div>
      {url ? (
        <>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-sm" onClick={() => void copy(url)}>Copier</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">Ouvrir</a>
            {canEdit && (
              <button type="button" className="btn btn-sm" onClick={() => void revokeLink({ shipmentId: shipment._id as Id<'shipments'> })}>
                Désactiver le lien
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="page-sub" style={{ marginBottom: '10px' }}>
            Un lien sans compte, mis à jour en direct, pour que votre client suive sa livraison au lieu d'appeler.
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void createLink({ shipmentId: shipment._id }).then((t) => copy(trackingUrl(t)))}
            >
              Générer et copier le lien
            </button>
          )}
        </>
      )}
      {notice && <div className="rec-notice" style={{ marginTop: '8px' }}>{notice}</div>}
    </div>
  )
}

/** Estimation CO2e de l'expédition (t·km × facteur). */
export function Co2Row({ shipmentId }: { shipmentId: Id<'shipments'> }) {
  const { data } = useSuspenseQuery(convexQuery(api.co2.forShipment, { shipmentId }))
  return (
    <div className="info-row">
      <span className="info-label">CO₂e estimé</span>
      <span className="info-value" title={data ? `${data.tonneKm} t·km × ${data.factor} kg/t·km${data.isDefaultFactor ? ' (facteur par défaut)' : ''}` : undefined}>
        {data ? `${data.co2Kg.toLocaleString('fr-FR')} kg` : '— (itinéraire inconnu)'}
      </span>
    </div>
  )
}

/** Pré-contrôle douane : régime, check-list, classification Praxio, confirmation. */
export function CustomsPanel({ shipment, canEdit }: { shipment: Doc<'shipments'>; canEdit: boolean }) {
  const { data: status } = useSuspenseQuery(convexQuery(api.praxio.status, { shipmentId: shipment._id }))
  const classify = useAction(api.praxio.classify)
  const confirm = useMutation(api.praxio.confirmHsCode)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!status || status.regime === 'domestic') return null
  const customs = shipment.customs
  const terminal = shipment.status === 'delivered' || shipment.status === 'cancelled'

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        Douane
        <span className="card-tag">{status.regime === 'extra_eu' ? 'hors UE' : status.regime === 'intra_eu' ? 'intra-UE' : 'à vérifier'}</span>
      </div>
      <div className="page-sub" style={{ marginBottom: '10px' }}>{status.regimeLabel}</div>
      {status.checklist.length > 0 && (
        <ul className="checklist">
          {status.checklist.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>
          ))}
        </ul>
      )}
      {error && <div className="auth-error">{error}</div>}
      {customs?.error && <div className="auth-error">{customs.error}</div>}

      {customs?.confirmedHsCode ? (
        <div className="info-list">
          <div className="info-row">
            <span className="info-label">Code SH confirmé</span>
            <span className="info-value mono">{customs.confirmedHsCode}</span>
          </div>
        </div>
      ) : (
        canEdit && !terminal && (
          <>
            {customs && customs.suggestions.length > 0 && (
              <table className="data-table" style={{ marginBottom: '10px' }}>
                <tbody>
                  {customs.suggestions.map((sug) => (
                    <tr key={sug.code}>
                      <td className="mono">{sug.code}</td>
                      <td>{sug.description ?? ''}</td>
                      <td className="mono">{sug.confidence !== undefined ? `${Math.round(sug.confidence * 100)}%` : ''}</td>
                      <td style={{ textAlign: 'right' }}>
                        {sug.code.replace(/\D/g, '').length >= 6 ? (
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                            onClick={() => void run(() => confirm({ shipmentId: shipment._id, code: sug.code }))}>
                            Confirmer
                          </button>
                        ) : (
                          // Position à 4 chiffres : insuffisante pour déclarer, on la fait compléter.
                          <button type="button" className="btn btn-sm" title="Position à 4 chiffres : complétez au moins la sous-position (6 chiffres)"
                            onClick={() => setManual(sug.code)}>
                            Préciser
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {status.praxioEnabled && (
                <button type="button" className="btn btn-sm" disabled={busy || !shipment.goodsDescription}
                  title={shipment.goodsDescription ? undefined : 'Décrivez la marchandise (Modifier)'}
                  onClick={() => void run(() => classify({ shipmentId: shipment._id }))}>
                  {customs ? 'Reclasser avec Praxio' : 'Classer avec Praxio'}
                </button>
              )}
              <input className="input" style={{ maxWidth: '160px' }} placeholder="ou code SH manuel" value={manual}
                onChange={(e) => setManual(e.target.value)} />
              <button type="button" className="btn btn-sm" disabled={busy || !manual.trim()}
                onClick={() => void run(() => confirm({ shipmentId: shipment._id, code: manual }).then(() => setManual('')))}>
                Confirmer
              </button>
            </div>
            {!status.praxioEnabled && (
              <div className="status-line">Connectez Praxio (Paramètres) pour obtenir une classification SH automatique.</div>
            )}
          </>
        )
      )}
    </div>
  )
}

const METHOD_LABEL: Record<string, string> = {
  gps: 'GPS en direct',
  route_history: "historique de l'itinéraire",
  route_plan: "durée prévue de l'itinéraire",
}

/** Arrivée prédite, fourchette, écart à l'engagement et explication. */
export function PredictionRow({ shipment }: { shipment: Doc<'shipments'> }) {
  const p = shipment.prediction
  if (!p) return null
  const committed = shipment.estimatedDelivery
  const overrunMin = committed !== undefined ? Math.round((p.eta - committed) / 60000) : null
  const late = overrunMin !== null && overrunMin >= 30
  const time = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const day = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  return (
    <div className="info-row" style={{ alignItems: 'flex-start' }}>
      <span className="info-label">Arrivée prédite</span>
      <span className="info-value" style={{ textAlign: 'right' }}>
        <span style={{ color: late ? '#ef4444' : '#00d4aa' }}>
          {day(p.eta)} {time(p.eta)}
          {overrunMin !== null && Math.abs(overrunMin) >= 5 && (
            <> ({overrunMin > 0 ? '+' : '−'}{Math.abs(overrunMin)} min vs engagement)</>
          )}
        </span>
        <div className="prediction-detail">
          entre {time(p.low)} et {time(p.high)} · {METHOD_LABEL[p.method]}
          <br />
          {p.explanation}
        </div>
      </span>
    </div>
  )
}
