import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'

type Item = FunctionReturnType<typeof api.recommendations.openActions>[number]
type Action = Item['actions'][number]

export function trackingUrl(token: string): string {
  return `${window.location.origin}/suivi/${token}`
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Une erreur est survenue'
  const m = raw.match(/Uncaught Error: (.+?)(\n|$)/)
  return m ? m[1] : raw
}

/**
 * Boutons « que faire maintenant » d'un incident. Les actions sûres
 * s'exécutent directement ; celles qui engagent l'extérieur (publier une
 * charge) demandent confirmation ; les autres mènent à l'écran concerné.
 */
export function RecommendedActions({ item, canAct }: { item: Item; canAct: boolean }) {
  const navigate = useNavigate()
  const publish = useMutation(api.fleetmarket.publish)
  const createLink = useMutation(api.publicTracking.createLink)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openShipment = () => {
    if (item.shipmentId) void navigate({ to: '/expeditions/$shipmentId', params: { shipmentId: item.shipmentId } })
  }

  const run = async (action: Action) => {
    setError(null)
    setNotice(null)
    switch (action.kind) {
      case 'publish_fleetmarket': {
        if (!item.shipmentId) return
        if (!window.confirm(`Publier ${item.shipmentRef ?? "l'expédition"} sur FleetMarket ? Des transporteurs externes verront la charge.`)) return
        setBusy(true)
        try {
          await publish({ shipmentId: item.shipmentId })
          setNotice('Publication envoyée — les propositions apparaîtront sur l’expédition.')
        } catch (err) {
          setError(cleanError(err))
        } finally {
          setBusy(false)
        }
        return
      }
      case 'share_tracking': {
        if (!item.shipmentId) return
        setBusy(true)
        try {
          const token = await createLink({ shipmentId: item.shipmentId })
          const url = trackingUrl(token)
          await navigator.clipboard.writeText(url).catch(() => undefined)
          setNotice(`Lien copié : ${url}`)
        } catch (err) {
          setError(cleanError(err))
        } finally {
          setBusy(false)
        }
        return
      }
      case 'hub_backlog':
        void navigate({ to: '/hubs' })
        return
      default:
        openShipment()
    }
  }

  const needsWrite = (k: Action['kind']) => k === 'publish_fleetmarket' || k === 'share_tracking' || k === 'assign_truck'
  const visible = item.actions.filter((a) => canAct || !needsWrite(a.kind))

  return (
    <div className="rec-actions">
      {visible.map((a) => (
        <button
          key={a.kind}
          type="button"
          className={`btn btn-sm${a.kind === 'publish_fleetmarket' || a.kind === 'review_proposals' ? ' btn-primary' : ''}`}
          title={a.reason || undefined}
          disabled={busy}
          onClick={() => void run(a)}
        >
          {a.label}
        </button>
      ))}
      {notice && <div className="rec-notice">{notice}</div>}
      {error && <div className="rec-error">{error}</div>}
    </div>
  )
}
