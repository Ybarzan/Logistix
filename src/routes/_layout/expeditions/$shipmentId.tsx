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
} from '../../../components/shipmentMeta'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/expeditions/$shipmentId')({
  head: () => ({ meta: [{ title: 'Expédition — Logistix' }] }),
  component: ShipmentDetailPage,
})

const statusSteps = [
  'pending',
  'loading',
  'in_transit',
  'delivered',
  'delayed',
  'cancelled',
] as const

function ShipmentDetailPage() {
  const { shipmentId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(
    convexQuery(api.shipments.getById, { shipmentId: shipmentId as Id<'shipments'> }),
  )
  const { data: events } = useSuspenseQuery(
    convexQuery(api.tracking.listByShipment, { shipmentId: shipmentId as Id<'shipments'> }),
  )
  const updateStatus = useMutation(api.shipments.updateStatus)
  const updateShipment = useMutation(api.shipments.update)
  const logEvent = useMutation(api.tracking.log)

  const [showEdit, setShowEdit] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
  const [editForm, setEditForm] = useState({ weight: '', priority: 'normal', customerName: '', customerRef: '', estimatedDelivery: '' })
  const [eventForm, setEventForm] = useState({ eventType: 'custom', description: '', location: '' })

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

  const changeStatus = async (status: string) => {
    await updateStatus({ shipmentId: shipment._id, status: status as typeof statusSteps[number] })
    refresh()
  }

  const openEdit = () => {
    setEditForm({
      weight: String(shipment.weight),
      priority: shipment.priority,
      customerName: shipment.customerName,
      customerRef: shipment.customerRef ?? '',
      estimatedDelivery: shipment.estimatedDelivery
        ? new Date(shipment.estimatedDelivery).toISOString().slice(0, 16)
        : '',
    })
    setShowEdit(true)
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    await updateShipment({
      shipmentId: shipment._id,
      weight: Number(editForm.weight) || undefined,
      priority: editForm.priority as 'low' | 'normal' | 'high' | 'urgent',
      customerName: editForm.customerName.trim() || undefined,
      customerRef: editForm.customerRef.trim() || null,
      estimatedDelivery: editForm.estimatedDelivery
        ? new Date(editForm.estimatedDelivery).getTime()
        : null,
    })
    setShowEdit(false)
    refresh()
  }

  const submitEvent = async (e: FormEvent) => {
    e.preventDefault()
    await logEvent({
      shipmentId: shipment._id,
      eventType: eventForm.eventType as 'created' | 'processed' | 'in_transit' | 'delayed' | 'delivered' | 'cancelled' | 'custom',
      description: eventForm.description.trim(),
      location: eventForm.location.trim() || undefined,
    })
    setEventForm({ eventType: 'custom', description: '', location: '' })
    setShowEvent(false)
    refresh()
  }

  const priorityColor = priorityColors[shipment.priority] || '#6b7a99'

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ marginBottom: '8px' }}>
            <Link className="link" to="/expeditions">← Expéditions</Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="page-title" style={{ color: '#3b82f6', fontFamily: "'DM Mono', monospace", fontSize: '20px' }}>
              {shipment.reference}
            </div>
            <span className={`status-pill ${statusClasses[shipment.status] || 'transit'}`}>
              {statusLabels[shipment.status] || shipment.status}
            </span>
            <span style={{
              fontSize: '10px',
              fontFamily: "'DM Mono', monospace",
              padding: '3px 8px',
              borderRadius: '10px',
              background: `${priorityColor}18`,
              color: priorityColor,
            }}>
              {shipment.priority.toUpperCase()}
            </span>
          </div>
          <div className="page-sub">
            {fromHub.city} → {toHub.city} · {shipment.weight.toLocaleString()} kg
          </div>
        </div>
        <button className="btn" onClick={openEdit}>Modifier</button>
      </div>

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
              <div className="info-row">
                <span className="info-label">Livraison réelle</span>
                <span className="info-value">{formatDate(shipment.actualDelivery)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Mise à jour du statut</div>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {statusSteps.map((step) => (
                <button
                  key={step}
                  type="button"
                  className={`seg-btn ${shipment.status === step ? 'active' : ''}`}
                  onClick={() => changeStatus(step)}
                >
                  {statusLabels[step]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: '10px' }}>
            Suivi en temps réel <span className="card-tag">{events.length} événements</span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" style={{ marginBottom: '14px' }} onClick={() => setShowEvent(true)}>
            + Ajouter un point de suivi
          </button>
          {events.length > 0 ? (
            <div className="timeline">
              {events.map((event) => (
                <div key={event._id} className="tl-item">
                  <div className="tl-left">
                    <div className="tl-dot" style={{ background: eventColors[event.eventType] || '#3d4a5c', width: '9px', height: '9px' }} />
                    <div className="tl-line" />
                  </div>
                  <div className="tl-content">
                    <div className="tl-event">{event.description}</div>
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