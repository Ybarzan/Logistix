import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Field, Modal, Select, TextArea, TextInput } from '../../components/form'
import { incidentTypeLabels, severityColors } from '../../components/shipmentMeta'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/incidents')({
  head: () => ({ meta: [{ title: 'Incidents — Logistix' }] }),
  component: IncidentsPage,
})

const statusLabels: Record<string, string> = {
  open: 'Ouvert',
  investigating: 'En cours',
  resolved: 'Résolu',
}

function IncidentsPage() {
  const queryClient = useQueryClient()
  const { data: incidents } = useSuspenseQuery(convexQuery(api.incidents.list, {}))
  const createIncident = useMutation(api.incidents.create)
  const resolveIncident = useMutation(api.incidents.resolve)
  const updateIncident = useMutation(api.incidents.update)

  const [status, setStatus] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({ type: 'other', severity: 'medium', title: '', description: '' })
  const [editForm, setEditForm] = useState({ type: 'other', severity: 'medium', title: '', description: '', status: 'open' })

  const refresh = () => queryClient.invalidateQueries()

  const filtered = incidents
    .filter((incident) => {
      if (status !== 'all' && incident.status !== status) return false
      if (severity !== 'all' && incident.severity !== severity) return false
      if (type !== 'all' && incident.type !== type) return false
      const q = query.trim().toLowerCase()
      if (q && ![incident.title, incident.description].join(' ').toLowerCase().includes(q)) {
        return false
      }
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  const counts = {
    open: incidents.filter((i) => i.status === 'open').length,
    investigating: incidents.filter((i) => i.status === 'investigating').length,
    resolved: incidents.filter((i) => i.status === 'resolved').length,
  }

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!createForm.title.trim()) return
    await createIncident({
      type: createForm.type as 'breakdown' | 'customs' | 'capacity' | 'delay' | 'damage' | 'other',
      severity: createForm.severity as 'low' | 'medium' | 'high' | 'critical',
      title: createForm.title.trim(),
      description: createForm.description.trim(),
    })
    setCreateForm({ type: 'other', severity: 'medium', title: '', description: '' })
    setShowCreate(false)
    refresh()
  }

  const openEdit = (incidentId: string, current: { type: string; severity: string; title: string; description: string; status: string }) => {
    setEditForm({
      type: current.type,
      severity: current.severity,
      title: current.title,
      description: current.description,
      status: current.status,
    })
    setShowEdit(incidentId)
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!showEdit) return
    await updateIncident({
      incidentId: showEdit as Id<'incidents'>,
      type: editForm.type as 'breakdown' | 'customs' | 'capacity' | 'delay' | 'damage' | 'other',
      severity: editForm.severity as 'low' | 'medium' | 'high' | 'critical',
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      status: editForm.status as 'open' | 'investigating' | 'resolved',
    })
    setShowEdit(null)
    refresh()
  }

  const doResolve = async (incidentId: Id<'incidents'>) => {
    await resolveIncident({ incidentId })
    refresh()
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Incidents</div>
          <div className="page-sub">{counts.open} ouverts · {counts.investigating} en cours · {counts.resolved} résolus</div>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setCreateForm({ type: 'other', severity: 'medium', title: '', description: '' })
          setShowCreate(true)
        }}>
          + Déclarer un incident
        </button>
      </div>

      <div className="toolbar">
        {[
          { key: 'all', label: `Tout (${incidents.length})` },
          { key: 'open', label: `Ouverts (${counts.open})` },
          { key: 'investigating', label: `En cours (${counts.investigating})` },
          { key: 'resolved', label: `Résolus (${counts.resolved})` },
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
          placeholder="Rechercher un incident…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select style={{ width: 'auto' }} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filtrer par sévérité">
          <option value="all">Sévérité : toutes</option>
          <option value="critical">Critique</option>
          <option value="high">Élevée</option>
          <option value="medium">Moyenne</option>
          <option value="low">Basse</option>
        </Select>
        <Select style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrer par type">
          <option value="all">Type : tous</option>
          {Object.entries(incidentTypeLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun incident ne correspond aux filtres.</div>
        ) : (
          filtered.map((incident) => {
            const color = severityColors[incident.severity] || '#6b7a99'
            return (
              <div key={incident._id} className="feed-item">
                <div className="feed-dot" style={{ background: color }} />
                <div className="feed-body">
                  <div className="feed-title">
                    <strong style={{ color: '#c8d0e0', fontWeight: 500 }}>{incident.title}</strong>
                    <span style={{
                      fontSize: '10px',
                      fontFamily: "'DM Mono', monospace",
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: `${color}18`,
                      color,
                    }}>
                      {incident.severity.toUpperCase()}
                    </span>
                    <span className={`status-pill ${incident.status === 'resolved' ? 'delivered' : incident.status === 'investigating' ? 'transit' : 'delayed'}`}>
                      {statusLabels[incident.status]}
                    </span>
                  </div>
                  <div className="feed-desc">{incident.description}</div>
                  <div className="feed-meta">
                    <span>{incidentTypeLabels[incident.type]}</span>
                    <span>{new Date(incident.createdAt).toLocaleString('fr-FR')}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                  {incident.status !== 'resolved' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => doResolve(incident._id)}
                      >
                        Résoudre
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openEdit(incident._id, incident)}
                      >
                        Modifier
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {showCreate && (
        <Modal title="Déclarer un incident" onClose={() => setShowCreate(false)}>
          <form onSubmit={submitCreate}>
            <div className="field-row">
              <Field label="Type">
                <Select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                  {Object.entries(incidentTypeLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Sévérité">
                <Select value={createForm.severity} onChange={(e) => setCreateForm({ ...createForm, severity: e.target.value })}>
                  <option value="low">Basse</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Élevée</option>
                  <option value="critical">Critique</option>
                </Select>
              </Field>
            </div>
            <Field label="Titre">
              <TextInput placeholder="ex. Rupture frigorifique" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <TextArea placeholder="Détails de l'incident…" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={!createForm.title.trim()}>Déclarer</button>
            </div>
          </form>
        </Modal>
      )}

      {showEdit && (
        <Modal title="Modifier l'incident" onClose={() => setShowEdit(null)}>
          <form onSubmit={submitEdit}>
            <div className="field-row">
              <Field label="Type">
                <Select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                  {Object.entries(incidentTypeLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Sévérité">
                <Select value={editForm.severity} onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })}>
                  <option value="low">Basse</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Élevée</option>
                  <option value="critical">Critique</option>
                </Select>
              </Field>
            </div>
            <Field label="Statut">
              <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="open">Ouvert</option>
                <option value="investigating">En cours</option>
                <option value="resolved">Résolu</option>
              </Select>
            </Field>
            <Field label="Titre">
              <TextInput value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <TextArea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowEdit(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}