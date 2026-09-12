import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Field, Modal, NumberInput, Select, TextInput } from '../../components/form'
import {
  formatDate,
  priorityColors,
  statusClasses,
  statusLabels,
} from '../../components/shipmentMeta'
import { can } from '../../components/rbac'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/expeditions')({
  head: () => ({ meta: [{ title: 'Expéditions — Logistix' }] }),
  component: ShipmentsPage,
})

const emptyForm = {
  fromHubId: '',
  toHubId: '',
  weight: '500',
  priority: 'normal',
  customerName: '',
  customerRef: '',
  estimatedDelivery: '',
}

function ShipmentsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: shipments } = useSuspenseQuery(convexQuery(api.shipments.list, {}))
  const { data: hubs } = useSuspenseQuery(convexQuery(api.hubs.list, {}))
  const { data: currentUser } = useSuspenseQuery(convexQuery(api.organizations.currentUser, {}))
  const createShipment = useMutation(api.shipments.create)
  const canCreate = can(currentUser?.role, 'operator')

  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [hubFilter, setHubFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultHubs = hubs.length
    ? hubs[0]._id
    : ''

  const filteredShipments = shipments
    .filter((s) => {
      if (status !== 'all' && s.status !== status) return false
      if (priority !== 'all' && s.priority !== priority) return false
      if (hubFilter !== 'all' && s.fromHubId !== hubFilter && s.toHubId !== hubFilter) {
        return false
      }
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        const haystack = [s.reference, s.customerName, s.customerRef ?? '']
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'heavy') return b.weight - a.weight
      if (sortBy === 'light') return a.weight - b.weight
      return b.createdAt - a.createdAt
    })

  const hubById = new Map(hubs.map((h) => [h._id as string, h]))
  const hubName = (id: string) => hubById.get(id)?.city ?? id.slice(-4)

  const counts = {
    all: shipments.length,
    pending: shipments.filter((s) => s.status === 'pending').length,
    in_transit: shipments.filter((s) => s.status === 'in_transit').length,
    delivered: shipments.filter((s) => s.status === 'delivered').length,
    delayed: shipments.filter((s) => s.status === 'delayed').length,
    loading: shipments.filter((s) => s.status === 'loading').length,
  }

  const hasHubs = hubs.length >= 2

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.fromHubId || !form.toHubId || !form.customerName.trim()) return
    setCreating(true)
    try {
      await createShipment({
        fromHubId: form.fromHubId as Id<'hubs'>,
        toHubId: form.toHubId as Id<'hubs'>,
        weight: Number(form.weight) || 0,
        priority: form.priority as 'low' | 'normal' | 'high' | 'urgent',
        customerName: form.customerName.trim(),
        customerRef: form.customerRef.trim() || undefined,
        estimatedDelivery: form.estimatedDelivery
          ? new Date(form.estimatedDelivery).getTime()
          : undefined,
      })
      setError(null)
      queryClient.invalidateQueries()
      setCreating(false)
      setShowCreate(false)
      setForm({ ...emptyForm, fromHubId: defaultHubs })
    } catch (err) {
      setCreating(false)
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Expéditions</div>
          <div className="page-sub">{counts.all} expéditions · {counts.in_transit} en transit</div>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => {
            setForm({ ...emptyForm, fromHubId: defaultHubs, toHubId: defaultHubs })
            setShowCreate(true)
          }}>
            + Nouvelle expédition
          </button>
        )}
      </div>

      <div className="toolbar">
        {[
          { key: 'all', label: `Tout (${counts.all})` },
          { key: 'pending', label: `En attente (${counts.pending})` },
          { key: 'loading', label: `Chargement (${counts.loading})` },
          { key: 'in_transit', label: `Transit (${counts.in_transit})` },
          { key: 'delivered', label: `Livrés (${counts.delivered})` },
          { key: 'delayed', label: `Retards (${counts.delayed})` },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip ${status === f.key ? 'active' : ''}`}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="searchbox"
          placeholder="Rechercher (réf., client…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          style={{ width: 'auto' }}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          aria-label="Filtrer par priorité"
        >
          <option value="all">Priorité : toutes</option>
          <option value="urgent">Priorité : urgente</option>
          <option value="high">Priorité : haute</option>
          <option value="normal">Priorité : normale</option>
          <option value="low">Priorité : basse</option>
        </Select>
        <Select
          style={{ width: 'auto' }}
          value={hubFilter}
          onChange={(e) => setHubFilter(e.target.value)}
          aria-label="Filtrer par hub"
        >
          <option value="all">Hub : tous</option>
          {hubs.map((h) => (
            <option key={h._id} value={h._id}>{h.city}</option>
          ))}
        </Select>
        <Select
          style={{ width: 'auto' }}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          aria-label="Trier"
        >
          <option value="recent">Tri : plus récentes</option>
          <option value="heavy">Tri : poids décroissant</option>
          <option value="light">Tri : poids croissant</option>
        </Select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2535' }}>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Réf.</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Trajet</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Client</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Créée</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Poids</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Priorité</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {filteredShipments.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    Aucune expédition ne correspond aux filtres.
                  </div>
                </td>
              </tr>
            )}
            {filteredShipments.map((s) => (
              <tr
                key={s._id}
                style={{ borderBottom: '1px solid #1a2135', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#0a0c10'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                onClick={() => navigate({ to: '/expeditions/$shipmentId', params: { shipmentId: s._id } })}
              >
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#3b82f6' }}>{s.reference}</td>
                <td style={{ padding: '14px 16px', fontSize: '13px', color: '#c8d0e0' }}>
                  {hubName(s.fromHubId)} → {hubName(s.toHubId)}
                </td>
                <td style={{ padding: '14px 16px', fontSize: '13px', color: '#8090a8' }}>
                  {s.customerName}
                  {s.customerRef ? <span style={{ color: '#3d4a5c' }}> · {s.customerRef}</span> : null}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#6b7a99' }}>
                  {formatDate(s.createdAt)}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#6b7a99' }}>{s.weight.toLocaleString()} kg</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{
                    fontSize: '10px',
                    fontFamily: "'DM Mono', monospace",
                    padding: '3px 8px',
                    borderRadius: '10px',
                    background: `${priorityColors[s.priority] || '#6b7a99'}18`,
                    color: priorityColors[s.priority] || '#6b7a99',
                  }}>
                    {s.priority.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span className={`status-pill ${statusClasses[s.status] || 'transit'}`}>
                    {statusLabels[s.status] || s.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Nouvelle expédition" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleSubmit}>
            <div className="field-row">
              <Field label="Hub de départ">
                <Select
                  value={form.fromHubId}
                  onChange={(e) => setForm({ ...form, fromHubId: e.target.value })}
                >
                  <option value="">Choisir…</option>
                  {hubs.map((h) => (
                    <option key={h._id} value={h._id}>{h.name} ({h.code})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Hub de destination">
                <Select
                  value={form.toHubId}
                  onChange={(e) => setForm({ ...form, toHubId: e.target.value })}
                >
                  <option value="">Choisir…</option>
                  {hubs.map((h) => (
                    <option key={h._id} value={h._id}>{h.name} ({h.code})</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="field-row">
              <Field label="Poids (kg)">
                <NumberInput
                  value={form.weight}
                  min={0}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                />
              </Field>
              <Field label="Priorité">
                <Select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  <option value="low">Basse</option>
                  <option value="normal">Normale</option>
                  <option value="high">Haute</option>
                  <option value="urgent">Urgente</option>
                </Select>
              </Field>
            </div>
            <Field label="Client">
              <TextInput
                placeholder="Nom du client"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
            </Field>
            <div className="field-row">
              <Field label="Référence client">
                <TextInput
                  placeholder="ex. NR-22118"
                  value={form.customerRef}
                  onChange={(e) => setForm({ ...form, customerRef: e.target.value })}
                />
              </Field>
              <Field label="Livraison estimée">
                <TextInput
                  type="datetime-local"
                  value={form.estimatedDelivery}
                  onChange={(e) => setForm({ ...form, estimatedDelivery: e.target.value })}
                />
              </Field>
            </div>
            {!hasHubs && (
              <div className="auth-error">
                Aucun hub disponible : lancez la commande seed pour initialiser l'organisation.
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={creating || !hasHubs}>
                {creating ? 'Création…' : 'Créer'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}