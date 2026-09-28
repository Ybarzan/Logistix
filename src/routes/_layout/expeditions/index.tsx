import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation, usePaginatedQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../../convex/_generated/api'
import { Field, Modal, NumberInput, Select, TextInput } from '../../../components/form'
import {
  formatDate,
  priorityColors,
  statusClasses,
  statusLabels,
} from '../../../components/shipmentMeta'
import { can } from '../../../components/rbac'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/expeditions/')({
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
  goodsDescription: '',
  declaredValueEur: '',
}

function ShipmentsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
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

  // Recherche avec anti-rebond : on n'interroge l'index qu'une fois la frappe posée.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { results: filteredShipments, status: pageStatus, loadMore } = usePaginatedQuery(
    api.shipments.search,
    {
      ...(status !== 'all' ? { status: status as 'pending' | 'loading' | 'in_transit' | 'delivered' | 'delayed' | 'cancelled' } : {}),
      ...(priority !== 'all' ? { priority: priority as 'low' | 'normal' | 'high' | 'urgent' } : {}),
      ...(hubFilter !== 'all' ? { hubId: hubFilter as Id<'hubs'> } : {}),
      ...(debounced ? { q: debounced } : {}),
      sort: sortBy as 'recent' | 'heavy' | 'light',
    },
    { initialNumItems: 30 },
  )
  const { data: statusCounts } = useSuspenseQuery(convexQuery(api.shipments.statusCounts, {}))
  const fmtCount = (n: number | undefined) => `${(n ?? 0).toLocaleString('fr-FR')}${statusCounts.capped && (n ?? 0) >= 5000 ? '+' : ''}`

  const hubById = new Map(hubs.map((h) => [h._id as string, h]))
  const hubName = (id: string) => hubById.get(id)?.city ?? id.slice(-4)

  const counts = {
    all: fmtCount(statusCounts.counts.all),
    pending: fmtCount(statusCounts.counts.pending),
    in_transit: fmtCount(statusCounts.counts.in_transit),
    delivered: fmtCount(statusCounts.counts.delivered),
    delayed: fmtCount(statusCounts.counts.delayed),
    loading: fmtCount(statusCounts.counts.loading),
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
        goodsDescription: form.goodsDescription.trim() || undefined,
        declaredValueEur: form.declaredValueEur ? Number(form.declaredValueEur) : undefined,
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
          placeholder="Rechercher (réf., client, réf. client…)"
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

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="ship-table">
          <thead>
            <tr>
              <th>Réf.</th>
              <th>Trajet</th>
              <th>Client</th>
              <th>Créée</th>
              <th>Poids</th>
              <th>Priorité</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {pageStatus === 'LoadingFirstPage' && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">Chargement…</div>
                </td>
              </tr>
            )}
            {pageStatus !== 'LoadingFirstPage' && filteredShipments.length === 0 && (
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
                onClick={() => navigate({ to: '/expeditions/$shipmentId', params: { shipmentId: s._id } })}
              >
                <td style={{ padding: '14px 16px', fontFamily: 'var(--font)', fontSize: '12px', color: 'var(--blue)' }}>
                  <Link
                    to="/expeditions/$shipmentId"
                    params={{ shipmentId: s._id }}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {s.reference}
                  </Link>
                </td>
                <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-2)' }}>
                  {hubName(s.fromHubId)} → {hubName(s.toHubId)}
                </td>
                <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--muted)' }}>
                  {s.customerName}
                  {s.customerRef ? <span style={{ color: 'var(--faint)' }}> · {s.customerRef}</span> : null}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: 'var(--font)', fontSize: '11px', color: 'var(--muted)' }}>
                  {formatDate(s.createdAt)}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: 'var(--font)', fontSize: '12px', color: 'var(--muted)' }}>{s.weight.toLocaleString()} kg</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font)',
                    padding: '3px 8px',
                    borderRadius: '10px',
                    background: `color-mix(in srgb, ${priorityColors[s.priority] || 'var(--muted)'} 12%, transparent)`,
                    color: priorityColors[s.priority] || 'var(--muted)',
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
        {(pageStatus === 'CanLoadMore' || pageStatus === 'LoadingMore') && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
            <button type="button" className="btn" disabled={pageStatus === 'LoadingMore'} onClick={() => loadMore(30)}>
              {pageStatus === 'LoadingMore' ? 'Chargement…' : `Charger plus (${filteredShipments.length} affichées)`}
            </button>
          </div>
        )}
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
            <div className="field-row">
              <Field label="Marchandise (pour la douane)">
                <TextInput
                  placeholder="ex. Chaises en chêne massif"
                  value={form.goodsDescription}
                  onChange={(e) => setForm({ ...form, goodsDescription: e.target.value })}
                />
              </Field>
              <Field label="Valeur déclarée (€)">
                <NumberInput
                  min="0"
                  value={form.declaredValueEur}
                  onChange={(e) => setForm({ ...form, declaredValueEur: e.target.value })}
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