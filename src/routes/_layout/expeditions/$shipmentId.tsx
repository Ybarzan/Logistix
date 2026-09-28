import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../../convex/_generated/api'
import { Field, Modal, NumberInput, Select, TextArea, TextInput } from '../../../components/form'
import {
  eventColors,
  formatDate,
  formatDateTime,
  formatDuration,
  priorityColors,
  statusClasses,
  statusLabels,
  toDatetimeLocal,
} from '../../../components/shipmentMeta'
import { can } from '../../../components/rbac'
import { LiveMap } from '../../../components/LiveMap'
import { ClientLinkPanel, Co2Row, CustomsPanel, FleetMarketPanel, PredictionRow } from '../../../components/ShipmentPanels'
import { SHIPMENT_TRANSITIONS, isTerminal } from '../../../../convex/shipmentStatus'
import type { ShipmentStatus } from '../../../../convex/shipmentStatus'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/expeditions/$shipmentId')({
  head: () => ({ meta: [{ title: 'Expédition — Logistix' }] }),
  component: ShipmentDetailPage,
})


function ShipmentDetailPage() {
  const { shipmentId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(
    convexQuery(api.shipments.getById, { shipmentId: shipmentId as Id<'shipments'> }),
  )
  const { data: events } = useSuspenseQuery(
    convexQuery(api.tracking.listByShipment, { shipmentId: shipmentId as Id<'shipments'> }),
  )
  const { data: currentUser } = useSuspenseQuery(convexQuery(api.organizations.currentUser, {}))
  const updateStatus = useMutation(api.shipments.updateStatus)
  const updateShipment = useMutation(api.shipments.update)
  const logEvent = useMutation(api.tracking.log)
  const assignTruck = useMutation(api.fleethub.assignTruck)
  const { data: vehicles } = useSuspenseQuery(convexQuery(api.fleethub.listVehicles, {}))
  const { data: trail } = useSuspenseQuery(
    convexQuery(api.fleethub.positionTrail, { shipmentId: shipmentId as Id<'shipments'> }),
  )
  const { data: network } = useSuspenseQuery(convexQuery(api.fleethub.networkMap, {}))
  const [truckInput, setTruckInput] = useState('')
  const canEdit = can(currentUser?.role, 'operator')

  const [showEdit, setShowEdit] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
  const [editForm, setEditForm] = useState({ weight: '', priority: 'normal', customerName: '', customerRef: '', estimatedDelivery: '', goodsDescription: '', declaredValueEur: '' })
  const [eventForm, setEventForm] = useState({ eventType: 'custom', description: '', location: '' })
  const [error, setError] = useState<string | null>(null)

  if (!data) {
    return (
      <div className="empty-state">
        Expédition introuvable ou accès refusé.
        <div style={{ marginTop: '14px' }}>
          <Link className="btn btn-sm" to="/expeditions">← Retour aux expéditions</Link>
        </div>
      </div>
    )
  }

  const { shipment, fromHub, toHub, route } = data

  const refresh = () => queryClient.invalidateQueries()

  const changeStatus = async (status: ShipmentStatus) => {
    if (status === 'cancelled' && !window.confirm('Annuler cette expédition ? Cette action est définitive.')) return
    try {
      await updateStatus({ shipmentId: shipment._id, status })
      setError(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const openEdit = () => {
    setEditForm({
      weight: String(shipment.weight),
      priority: shipment.priority,
      customerName: shipment.customerName,
      customerRef: shipment.customerRef ?? '',
      estimatedDelivery: shipment.estimatedDelivery
        ? toDatetimeLocal(shipment.estimatedDelivery)
        : '',
      goodsDescription: shipment.goodsDescription ?? '',
      declaredValueEur: shipment.declaredValueEur !== undefined ? String(shipment.declaredValueEur) : '',
    })
    setShowEdit(true)
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await updateShipment({
        shipmentId: shipment._id,
        weight: Number(editForm.weight) || undefined,
        priority: editForm.priority as 'low' | 'normal' | 'high' | 'urgent',
        customerName: editForm.customerName.trim() || undefined,
        customerRef: editForm.customerRef.trim() || null,
        goodsDescription: editForm.goodsDescription.trim() || null,
        declaredValueEur: editForm.declaredValueEur ? Number(editForm.declaredValueEur) : null,
        estimatedDelivery: editForm.estimatedDelivery
          ? new Date(editForm.estimatedDelivery).getTime()
          : null,
      })
      setError(null)
      setShowEdit(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const submitEvent = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await logEvent({
        shipmentId: shipment._id,
        eventType: eventForm.eventType as 'created' | 'processed' | 'in_transit' | 'delayed' | 'delivered' | 'cancelled' | 'custom',
        description: eventForm.description.trim(),
        location: eventForm.location.trim() || undefined,
      })
      setError(null)
      setEventForm({ eventType: 'custom', description: '', location: '' })
      setShowEvent(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const priorityColor = priorityColors[shipment.priority] || 'var(--muted)'

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ marginBottom: '8px' }}>
            <Link className="link" to="/expeditions">← Expéditions</Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="page-title" style={{ color: 'var(--blue)', fontFamily: 'var(--font)', fontSize: '20px' }}>
              {shipment.reference}
            </div>
            <span className={`status-pill ${statusClasses[shipment.status] || 'transit'}`}>
              {statusLabels[shipment.status] || shipment.status}
            </span>
            <span style={{
              fontSize: '10px',
              fontFamily: 'var(--font)',
              padding: '3px 8px',
              borderRadius: '10px',
              background: `color-mix(in srgb, ${priorityColor} 12%, transparent)`,
              color: priorityColor,
            }}>
              {shipment.priority.toUpperCase()}
            </span>
          </div>
          <div className="page-sub">
            {fromHub.city} → {toHub.city} · {shipment.weight.toLocaleString()} kg
          </div>
        </div>
        {canEdit && !isTerminal(shipment.status) && <button className="btn" onClick={openEdit}>Modifier</button>}
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="detail-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="card">
            <div className="card-title">
              Informations <span className="card-tag">{fromHub.code} → {toHub.code}</span>
            </div>
            <div className="info-list">
              <div className="info-row">
                <span className="info-label">Client</span>
                <span className="info-value">{shipment.customerName}{shipment.customerRef ? ` · ${shipment.customerRef}` : ''}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Itinéraire</span>
                <span className="info-value">
                  {route ? `${route.name} · ${route.distance} km · ≈${formatDuration(route.avgDuration)}` : 'Non affecté'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Hub de départ</span>
                <span className="info-value">{fromHub.name} — {fromHub.city}, {fromHub.country}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Hub d'arrivée</span>
                <span className="info-value">{toHub.name} — {toHub.city}, {toHub.country}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Créée le</span>
                <span className="info-value">{formatDateTime(shipment.createdAt)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Livraison estimée</span>
                <span className="info-value">{formatDate(shipment.estimatedDelivery)}</span>
              </div>
              <PredictionRow shipment={shipment} />
              <div className="info-row">
                <span className="info-label">Livraison réelle</span>
                <span className="info-value">{formatDate(shipment.actualDelivery)}</span>
              </div>
              <Co2Row shipmentId={shipment._id} />
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              Camion &amp; position
              {shipment.lastPosition && (
                <span className="card-tag">
                  GPS · {formatDateTime(shipment.lastPosition.recordedAt)}
                  {shipment.lastPosition.speedKph !== undefined ? ` · ${Math.round(shipment.lastPosition.speedKph)} km/h` : ''}
                </span>
              )}
            </div>
            <div className="info-list">
              <div className="info-row">
                <span className="info-label">Camion</span>
                <span className="info-value mono">{shipment.truckRegistration ?? 'Non affecté'}</span>
              </div>
            </div>
            {canEdit && !isTerminal(shipment.status) && (
              <form
                style={{ display: 'flex', gap: '8px', marginTop: '10px' }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void assignTruck({ shipmentId: shipment._id, registration: truckInput.trim() || null })
                    .then(() => { setTruckInput(''); setError(null) })
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erreur'))
                }}
              >
                <input
                  className="input"
                  list="fleet-vehicles"
                  placeholder={vehicles.length > 0 ? 'Immatriculation (liste fleet-hub)' : 'Immatriculation fleet-hub'}
                  value={truckInput}
                  onChange={(e) => setTruckInput(e.target.value)}
                />
                <datalist id="fleet-vehicles">
                  {vehicles.map((v) => (
                    <option key={v.registration} value={v.registration}>
                      {v.capacityTons !== undefined ? `${v.capacityTons} t` : ''}
                    </option>
                  ))}
                </datalist>
                <button type="submit" className="btn btn-sm">{truckInput.trim() ? 'Affecter' : 'Retirer'}</button>
              </form>
            )}
            <div style={{ marginTop: '12px' }}>
              <LiveMap
                height={260}
                hubs={network.hubs
                  .filter((h) => h._id === fromHub._id || h._id === toHub._id)
                  .map((h) => ({ id: h._id, lat: h.lat, lng: h.lng, label: `${h.code} · ${h.name}` }))}
                trucks={
                  shipment.lastPosition && shipment.truckRegistration
                    ? [{
                        id: shipment._id,
                        lat: shipment.lastPosition.lat,
                        lng: shipment.lastPosition.lng,
                        label: shipment.truckRegistration,
                        stale: Date.now() - shipment.lastPosition.recordedAt > 30 * 60 * 1000,
                      }]
                    : []
                }
                trail={trail.map((p) => [p.lat, p.lng] as [number, number])}
                plannedLine={(() => {
                  const a = network.hubs.find((h) => h._id === fromHub._id)
                  const b = network.hubs.find((h) => h._id === toHub._id)
                  return a && b ? [[a.lat, a.lng], [b.lat, b.lng]] : undefined
                })()}
              />
            </div>
          </div>

          <CustomsPanel shipment={shipment} canEdit={canEdit} />
          <FleetMarketPanel shipment={shipment} canEdit={canEdit} />
          <ClientLinkPanel shipment={shipment} canEdit={canEdit} />

          {canEdit && !isTerminal(shipment.status) && (
            <div className="card">
              <div className="card-title">
                Mise à jour du statut <span className="card-tag">actuel : {statusLabels[shipment.status]}</span>
              </div>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {SHIPMENT_TRANSITIONS[shipment.status].map((step) => (
                  <button
                    key={step}
                    type="button"
                    className="seg-btn"
                    onClick={() => changeStatus(step)}
                  >
                    → {statusLabels[step]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: '10px' }}>
            Suivi en temps réel <span className="card-tag">{events.length} événements</span>
          </div>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-primary" style={{ marginBottom: '14px' }} onClick={() => setShowEvent(true)}>
              + Ajouter un point de suivi
            </button>
          )}
          {events.length > 0 ? (
            <div className="timeline">
              {events.map((event) => (
                <div key={event._id} className="tl-item">
                  <div className="tl-left">
                    <div className="tl-dot" style={{ background: eventColors[event.eventType] || 'var(--faint)', width: '9px', height: '9px' }} />
                    <div className="tl-line" />
                  </div>
                  <div className="tl-content">
                    <div className="tl-event">{event.description}{event.source && event.source !== 'manual' && <span className={`source-tag ${event.source}`}>{event.source === 'gps' ? 'GPS' : 'Auto'}</span>}</div>
                    <div className="tl-time">
                      {formatDateTime(event._creationTime)}
                      {event.location ? ` · ${event.location}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Aucun événement de suivi pour l'instant.</div>
          )}
        </div>
      </div>

      {showEdit && (
        <Modal title={`Modifier ${shipment.reference}`} onClose={() => setShowEdit(false)}>
          <form onSubmit={submitEdit}>
            <div className="field-row">
              <Field label="Poids (kg)">
                <NumberInput value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} />
              </Field>
              <Field label="Priorité">
                <Select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                  <option value="low">Basse</option>
                  <option value="normal">Normale</option>
                  <option value="high">Haute</option>
                  <option value="urgent">Urgente</option>
                </Select>
              </Field>
            </div>
            <Field label="Client">
              <TextInput value={editForm.customerName} onChange={(e) => setEditForm({ ...editForm, customerName: e.target.value })} />
            </Field>
            <div className="field-row">
              <Field label="Référence client">
                <TextInput value={editForm.customerRef} onChange={(e) => setEditForm({ ...editForm, customerRef: e.target.value })} />
              </Field>
              <Field label="Livraison estimée">
                <TextInput type="datetime-local" value={editForm.estimatedDelivery} onChange={(e) => setEditForm({ ...editForm, estimatedDelivery: e.target.value })} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Marchandise (pour la douane)">
                <TextInput value={editForm.goodsDescription} onChange={(e) => setEditForm({ ...editForm, goodsDescription: e.target.value })} />
              </Field>
              <Field label="Valeur déclarée (€)">
                <NumberInput min="0" value={editForm.declaredValueEur} onChange={(e) => setEditForm({ ...editForm, declaredValueEur: e.target.value })} />
              </Field>
            </div>
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowEdit(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}

      {showEvent && (
        <Modal title="Ajouter un point de suivi" onClose={() => setShowEvent(false)}>
          <form onSubmit={submitEvent}>
            <div className="field-row">
              <Field label="Type">
                <Select value={eventForm.eventType} onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })}>
                  <option value="created">Création</option>
                  <option value="processed">Traitement</option>
                  <option value="in_transit">En transit</option>
                  <option value="delayed">Retard</option>
                  <option value="delivered">Livraison</option>
                  <option value="cancelled">Annulation</option>
                  <option value="custom">Personnalisé</option>
                </Select>
              </Field>
              <Field label="Localisation">
                <TextInput placeholder="ex. Péage A7, km 142" value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} />
              </Field>
            </div>
            <Field label="Description">
              <TextArea placeholder="Détail de l'événement…" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} />
            </Field>
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowEvent(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={!eventForm.description.trim()}>Ajouter</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}