import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useAction, useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { Field, TextInput } from './form'
import { formatDateTime } from './shipmentMeta'
import type { FormEvent } from 'react'

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Une erreur est survenue'
  const m = raw.match(/Uncaught Error: (.+?)(\n|$)/)
  return m ? m[1] : raw
}

/** URL publique de l'API (site Convex), figée au build. */
const API_BASE = (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? 'https://<votre-site-convex>'

function SecretOnce({ label, value }: { label: string; value: string }) {
  return (
    <div className="invite-link">
      <div className="field-label">{label} — copiez-la maintenant, elle ne sera plus affichée</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input className="input mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(value)}>Copier</button>
      </div>
    </div>
  )
}

export function ApiKeysCard() {
  const { data: keys } = useSuspenseQuery(convexQuery(api.apiKeys.list, {}))
  const create = useAction(api.apiKeys.create)
  const revoke = useMutation(api.apiKeys.revoke)
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { apiKey } = await create({ name })
      setFresh(apiKey)
      setName('')
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: '14px' }}>
      <div className="card-title">API <span className="card-tag">REST v1</span></div>
      <div className="page-sub" style={{ marginBottom: '12px' }}>
        Votre ERP, WMS ou portail crée les expéditions et lit statut, ETA prédite et historique. Une clé agit sur votre
        organisation uniquement, avec des droits d&apos;opérateur.
      </div>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={submit} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <Field label="Nom de la clé">
          <TextInput placeholder="ex. ERP production" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary" style={{ marginBottom: '12px' }} disabled={busy}>Créer</button>
      </form>
      {fresh && <SecretOnce label="Clé d'API" value={fresh} />}
      {keys.length > 0 && (
        <table className="data-table" style={{ marginTop: '12px' }}>
          <thead><tr><th>Nom</th><th>Préfixe</th><th>Dernier usage</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k._id}>
                <td>{k.name}</td>
                <td className="mono">{k.prefix}…</td>
                <td>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'jamais'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sm"
                    onClick={() => { if (window.confirm(`Révoquer « ${k.name} » ? Les intégrations qui l'utilisent seront coupées.`)) void revoke({ keyId: k._id }) }}>
                    Révoquer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details style={{ marginTop: '12px' }}>
        <summary className="field-label" style={{ cursor: 'pointer' }}>Documentation rapide</summary>
        <pre className="api-doc">{`Base : ${API_BASE}/api/v1
Auth : Authorization: Bearer lx_live_…

POST /shipments                  créer (idempotent sur customerRef)
  { "fromHubCode": "LYS", "toHubCode": "MRS", "weightKg": 1200,
    "customerName": "Client", "customerRef": "PO-4411",
    "priority": "high", "estimatedDelivery": "2026-10-01T16:00:00Z",
    "goodsDescription": "…", "declaredValueEur": 4200 }
GET  /shipments?status=in_transit&limit=50
GET  /shipments/{référence}      statut, ETA prédite, position, événements
POST /shipments/{référence}/status   { "status": "in_transit", "note": "…" }

Erreurs : { "error": { "code", "message" } } — 400 / 401 / 404 / 422`}</pre>
      </details>
    </div>
  )
}

const EVENT_LABELS = {
  'shipment.created': 'Expédition créée',
  'shipment.status_changed': 'Statut modifié',
  'incident.opened': 'Incident ouvert (dont retard prévu)',
  'incident.resolved': 'Incident résolu',
} as const
type EventType = keyof typeof EVENT_LABELS

export function WebhooksCard() {
  const { data: hooks } = useSuspenseQuery(convexQuery(api.webhooks.list, {}))
  const create = useMutation(api.webhooks.create)
  const setEnabled = useMutation(api.webhooks.setEnabled)
  const remove = useMutation(api.webhooks.remove)
  const sendTest = useMutation(api.webhooks.sendTest)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<Array<EventType>>(['shipment.status_changed', 'incident.opened'])
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await create({ url, events })
      setSecret(res.secret)
      setUrl('')
    } catch (err) {
      setError(cleanError(err))
    }
  }

  return (
    <div className="card" style={{ marginTop: '14px' }}>
      <div className="card-title">Webhooks <span className="card-tag">signés HMAC-SHA256</span></div>
      <div className="page-sub" style={{ marginBottom: '12px' }}>
        LogistiX prévient votre système en temps réel. En-tête <span className="mono">X-LogistiX-Signature: t=…,v1=…</span> =
        HMAC-SHA256(secret, «t.corps») ; relances à 1 min, 5 min, 30 min, 2 h.
      </div>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={submit}>
        <Field label="URL de réception">
          <TextInput placeholder="https://erp.exemple.fr/hooks/logistix" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          {(Object.keys(EVENT_LABELS) as Array<EventType>).map((ev) => (
            <label key={ev} className="field-label" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))}
              />
              {EVENT_LABELS[ev]}
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!url.trim() || events.length === 0}>Ajouter</button>
      </form>
      {secret && <SecretOnce label="Secret de signature" value={secret} />}
      {hooks.map((h) => (
        <div key={h._id} className="webhook-row">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <span className="mono" style={{ wordBreak: 'break-all' }}>{h.url}</span>
            <span style={{ display: 'flex', gap: '6px' }}>
              <button type="button" className="btn btn-sm" onClick={() => void sendTest({ webhookId: h._id })}>Tester</button>
              <button type="button" className="btn btn-sm" onClick={() => void setEnabled({ webhookId: h._id, enabled: !h.enabled })}>
                {h.enabled ? 'Désactiver' : 'Activer'}
              </button>
              <button type="button" className="btn btn-sm"
                onClick={() => { if (window.confirm('Supprimer ce webhook ?')) void remove({ webhookId: h._id }) }}>
                Supprimer
              </button>
            </span>
          </div>
          <div className="status-line" style={{ marginTop: '4px' }}>
            {h.events.map((e) => EVENT_LABELS[e]).join(' · ')} · secret {h.secretHint}{h.enabled ? '' : ' · désactivé'}
            {h.recent.map((r, i) => (
              <div key={i}>
                {formatDateTime(r.createdAt)} — {r.type} —{' '}
                <span className={r.status === 'failed' ? 'err' : ''}>
                  {r.status === 'delivered' ? `livré (${r.lastStatusCode ?? ''})` : r.status === 'failed' ? `échec (${r.lastError ?? r.lastStatusCode})` : `en attente, ${r.attempts} tentative(s)`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
