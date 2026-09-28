import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Field, Modal, NumberInput, Select, TextInput } from '../../components/form'
import { can } from '../../components/rbac'
import { LiveMap } from '../../components/LiveMap'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/hubs')({
  head: () => ({ meta: [{ title: 'Entrepôts — Logistix' }] }),
  component: HubsPage,
})

type MockHub = {
  _id: string
  name: string
  code: string
  city: string
  country: string
  capacity: number
  currentLoad: number
  lat: number
  lng: number
  isActive: boolean
}

function HubCard({
  hub,
  real,
  canManage,
  onToggle,
  onEdit,
  forecast,
}: {
  hub: MockHub
  forecast?: { inboundKg: number; arrivals: number; peakPct: number; crossesAt?: number }
  real: boolean
  canManage: boolean
  onToggle?: () => void
  onEdit?: () => void
}) {
  const loadPct = Math.round((hub.currentLoad / hub.capacity) * 100)
  const loadColor = loadPct > 85 ? 'var(--red)' : loadPct > 70 ? 'var(--amber)' : 'var(--accent)'
  return (
    <div className="card" style={{ cursor: real ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>{hub.name}</div>
          <div style={{ fontSize: '11px', fontFamily: 'var(--font)', color: 'var(--faint)', marginTop: '2px' }}>
            {hub.code} · {hub.city}, {hub.country}
          </div>
        </div>
        <div style={{
          fontSize: '10px',
          fontFamily: 'var(--font)',
          padding: '3px 8px',
          borderRadius: '10px',
          background: hub.isActive ? 'rgba(31, 224, 184, 0.08)' : 'rgba(255, 95, 109, 0.08)',
          color: hub.isActive ? 'var(--accent)' : 'var(--red)',
        }}>
          {hub.isActive ? 'Actif' : 'Inactif'}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font)', color: 'var(--faint)' }}>Charge</span>
          <span style={{ fontSize: '12px', fontFamily: 'var(--font)', color: loadColor }}>{loadPct}%</span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${loadPct}%`, background: loadColor }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
        <div className="mini-stat" style={{ textAlign: 'left', padding: '0' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>{hub.currentLoad.toLocaleString()}</div>
          <div style={{ fontSize: '10px', fontFamily: 'var(--font)', color: 'var(--faint)' }}>Charge actuelle (kg)</div>
        </div>
        <div className="mini-stat" style={{ textAlign: 'left', padding: '0' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>{hub.capacity.toLocaleString()}</div>
          <div style={{ fontSize: '10px', fontFamily: 'var(--font)', color: 'var(--faint)' }}>Capacité (kg)</div>
        </div>
      </div>

      {forecast && forecast.arrivals > 0 && (
        <div className={`hub-forecast${forecast.crossesAt !== undefined ? ' warn' : ''}`}>
          24 h : +{(forecast.inboundKg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t en arrivée ({forecast.arrivals}) → pic {forecast.peakPct}%
          {forecast.crossesAt !== undefined && (
            <> · saturation vers {new Date(forecast.crossesAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</>
          )}
        </div>
      )}
      <div style={{ marginTop: '10px', fontSize: '10px', fontFamily: 'var(--font)', color: 'var(--faint)' }}>
        {hub.lat.toFixed(4)}°, {hub.lng.toFixed(4)}°
      </div>

      {real && canManage && onToggle && onEdit && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
          <button type="button" className="btn btn-sm" onClick={onEdit}>Modifier</button>
          <button type="button" className={`btn btn-sm ${hub.isActive ? 'btn-danger' : ''}`} onClick={onToggle}>
            {hub.isActive ? 'Désactiver' : 'Activer'}
          </button>
        </div>
      )}
    </div>
  )
}

function HubsPage() {
  const queryClient = useQueryClient()
  const { data: hubs } = useSuspenseQuery(convexQuery(api.hubs.list, {}))
  const { data: network } = useSuspenseQuery(convexQuery(api.fleethub.networkMap, {}))
  const { data: forecasts } = useSuspenseQuery(convexQuery(api.hubForecast.forecast, {}))
  const forecastByHub = new Map(forecasts.map((f) => [f.hubId as string, f]))
  const { data: currentUser } = useSuspenseQuery(convexQuery(api.organizations.currentUser, {}))
  const createHub = useMutation(api.hubs.create)
  const updateHub = useMutation(api.hubs.update)
  const canManage = can(currentUser?.role, 'manager')

  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const emptyCreate = { name: '', code: '', city: '', country: 'France', capacity: '30000', currentLoad: '0', lat: '46.0', lng: '2.0', isActive: 'true' }
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [editForm, setEditForm] = useState({ name: '', city: '', country: '', capacity: '', currentLoad: '', lat: '', lng: '' })

  const refresh = () => queryClient.invalidateQueries()

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!createForm.name.trim() || !createForm.code.trim() || !createForm.city.trim()) return
    try {
      await createHub({
        name: createForm.name.trim(),
        code: createForm.code.trim().toUpperCase(),
        city: createForm.city.trim(),
        country: createForm.country.trim(),
        capacity: Number(createForm.capacity) || 0,
        currentLoad: Number(createForm.currentLoad) || 0,
        lat: Number(createForm.lat) || 0,
        lng: Number(createForm.lng) || 0,
        isActive: createForm.isActive === 'true',
      })
      setError(null)
      setCreateForm(emptyCreate)
      setShowCreate(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const openEdit = (hub: MockHub) => {
    setEditForm({
      name: hub.name,
      city: hub.city,
      country: hub.country,
      capacity: String(hub.capacity),
      currentLoad: String(hub.currentLoad),
      lat: String(hub.lat),
      lng: String(hub.lng),
    })
    setEditId(hub._id)
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editId) return
    try {
      await updateHub({
        hubId: editId as Id<'hubs'>,
        name: editForm.name.trim() || undefined,
        city: editForm.city.trim() || undefined,
        country: editForm.country.trim() || undefined,
        capacity: Number(editForm.capacity) || undefined,
        currentLoad: Number(editForm.currentLoad) || undefined,
        lat: Number(editForm.lat) || undefined,
        lng: Number(editForm.lng) || undefined,
      })
      setError(null)
      setEditId(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const toggleActive = async (hub: MockHub) => {
    try {
      await updateHub({ hubId: hub._id as Id<'hubs'>, isActive: !hub.isActive })
      setError(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Entrepôts</div>
          <div className="page-sub">{hubs.filter((h) => h.isActive).length} hubs actifs</div>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => {
            setCreateForm(emptyCreate)
            setShowCreate(true)
          }}>
            + Ajouter un hub
          </button>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {hubs.length === 0 ? (
        <div className="card">
          <div className="empty-state">Aucun hub configuré. Ajoutez votre premier hub pour démarrer.</div>
        </div>
      ) : (
        <div className="hub-grid">
          {hubs.map((hub) => (
            <HubCard
              key={hub._id}
              hub={hub}
              forecast={forecastByHub.get(hub._id)}
              real
              canManage={canManage}
              onToggle={() => toggleActive(hub)}
              onEdit={() => openEdit(hub)}
            />
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: '14px' }}>
        <div className="card-title">
          Carte du réseau
          <span className="card-tag">{network.trucks.length} camion(s) suivi(s) en GPS</span>
        </div>
        <LiveMap
          height={340}
          hubs={network.hubs.map((h) => ({
            id: h._id, lat: h.lat, lng: h.lng, label: `${h.code} · ${h.name}`, loadPct: h.loadPct, muted: !h.isActive,
          }))}
          trucks={network.trucks.map((t) => ({
            id: t.shipmentId,
            lat: t.lat,
            lng: t.lng,
            label: `${t.registration} · ${t.reference}`,
            href: `/expeditions/${t.shipmentId}`,
            stale: Date.now() - t.recordedAt > 30 * 60 * 1000,
          }))}
        />
      </div>

      {showCreate && (
        <Modal title="Ajouter un hub" onClose={() => setShowCreate(false)}>
          <form onSubmit={submitCreate}>
            <div className="field-row">
              <Field label="Nom">
                <TextInput placeholder="ex. Paris CDG" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              </Field>
              <Field label="Code">
                <TextInput placeholder="ex. CDG" value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Ville">
                <TextInput placeholder="ex. Paris" value={createForm.city} onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })} />
              </Field>
              <Field label="Pays">
                <TextInput value={createForm.country} onChange={(e) => setCreateForm({ ...createForm, country: e.target.value })} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Capacité (kg)">
                <NumberInput min={0} value={createForm.capacity} onChange={(e) => setCreateForm({ ...createForm, capacity: e.target.value })} />
              </Field>
              <Field label="Charge actuelle (kg)">
                <NumberInput min={0} value={createForm.currentLoad} onChange={(e) => setCreateForm({ ...createForm, currentLoad: e.target.value })} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Latitude">
                <NumberInput step="any" value={createForm.lat} onChange={(e) => setCreateForm({ ...createForm, lat: e.target.value })} />
              </Field>
              <Field label="Longitude">
                <NumberInput step="any" value={createForm.lng} onChange={(e) => setCreateForm({ ...createForm, lng: e.target.value })} />
              </Field>
            </div>
            <Field label="Statut">
              <Select value={createForm.isActive} onChange={(e) => setCreateForm({ ...createForm, isActive: e.target.value })}>
                <option value="true">Actif</option>
                <option value="false">Inactif</option>
              </Select>
            </Field>
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary">Créer le hub</button>
            </div>
          </form>
        </Modal>
      )}

      {editId && (
        <Modal title="Modifier le hub" onClose={() => setEditId(null)}>
          <form onSubmit={submitEdit}>
            <div className="field-row">
              <Field label="Nom">
                <TextInput value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </Field>
              <Field label="Ville">
                <TextInput value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Pays">
                <TextInput value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} />
              </Field>
              <Field label="Charge actuelle (kg)">
                <NumberInput min={0} value={editForm.currentLoad} onChange={(e) => setEditForm({ ...editForm, currentLoad: e.target.value })} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Capacité (kg)">
                <NumberInput min={0} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} />
              </Field>
              <Field label="Latitude">
                <NumberInput step="any" value={editForm.lat} onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })} />
              </Field>
            </div>
            <Field label="Longitude">
              <NumberInput step="any" value={editForm.lng} onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })} />
            </Field>
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditId(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}