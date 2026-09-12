import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Field, Modal, NumberInput, Select, TextInput } from '../../components/form'
import { formatDuration } from '../../components/shipmentMeta'
import { can } from '../../components/rbac'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/routes')({
  head: () => ({ meta: [{ title: 'Itinéraires — Logistix' }] }),
  component: RoutesPage,
})

type MockRoute = {
  _id: string
  name: string
  fromHubId: string
  toHubId: string
  distance: number
  avgDuration: number
  isActive: boolean
}

function RoutesPage() {
  const queryClient = useQueryClient()
  const { data: routes } = useSuspenseQuery(convexQuery(api.routes.list, {}))
  const { data: hubs } = useSuspenseQuery(convexQuery(api.hubs.list, {}))
  const { data: currentUser } = useSuspenseQuery(convexQuery(api.organizations.currentUser, {}))
  const createRoute = useMutation(api.routes.create)
  const updateRoute = useMutation(api.routes.update)
  const canManage = can(currentUser?.role, 'manager')

  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const emptyCreate = { name: '', fromHubId: '', toHubId: '', distance: '300', avgDuration: '240', isActive: 'true' }
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [editForm, setEditForm] = useState({ name: '', distance: '', avgDuration: '' })
  const [error, setError] = useState<string | null>(null)

  const realRoutes = routes.length > 0

  const getHubCity = (hubId: string) => {
    return hubs.find((h) => h._id === hubId)?.city ?? hubId.slice(-4)
  }

  const refresh = () => queryClient.invalidateQueries()

  const defaultHub = hubs.length > 0 ? hubs[0]._id : ''

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!createForm.name.trim() || !createForm.fromHubId || !createForm.toHubId) return
    try {
      await createRoute({
        name: createForm.name.trim(),
        fromHubId: createForm.fromHubId as Id<'hubs'>,
        toHubId: createForm.toHubId as Id<'hubs'>,
        distance: Number(createForm.distance) || 0,
        avgDuration: Number(createForm.avgDuration) || 0,
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

  const openEdit = (route: MockRoute) => {
    setEditForm({
      name: route.name,
      distance: String(route.distance),
      avgDuration: String(route.avgDuration),
    })
    setEditId(route._id)
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editId) return
    try {
      await updateRoute({
        routeId: editId as Id<'routes'>,
        name: editForm.name.trim() || undefined,
        distance: Number(editForm.distance) || undefined,
        avgDuration: Number(editForm.avgDuration) || undefined,
      })
      setError(null)
      setEditId(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const toggleActive = async (route: MockRoute) => {
    try {
      await updateRoute({ routeId: route._id as Id<'routes'>, isActive: !route.isActive })
      setError(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  const display = routes
  const activeCount = display.filter((r) => r.isActive).length

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Itinéraires</div>
          <div className="page-sub">{activeCount} routes actives</div>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => {
            setCreateForm({ ...emptyCreate, fromHubId: defaultHub, toHubId: defaultHub })
            setShowCreate(true)
          }}>
            + Nouvelle route
          </button>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2535' }}>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Route</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Origine</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Destination</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Distance</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Durée moy.</th>
              <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c', letterSpacing: '1px', textTransform: 'uppercase' }}>Statut</th>
              {realRoutes && canManage ? <th style={{ width: '150px' }} /> : null}
            </tr>
          </thead>
          <tbody>
            {display.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">Aucun itinéraire configuré.</div>
                </td>
              </tr>
            )}
            {display.map((route) => (
              <tr key={route._id} style={{ borderBottom: '1px solid #1a2135' }}>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: '13px', color: '#c8d0e0', fontWeight: 500 }}>{route.name}</div>
                </td>
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#6b7a99' }}>
                  {getHubCity(route.fromHubId)}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#6b7a99' }}>
                  {getHubCity(route.toHubId)}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#3d4a5c' }}>
                  {route.distance.toLocaleString()} km
                </td>
                <td style={{ padding: '14px 16px', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#3d4a5c' }}>
                  {formatDuration(route.avgDuration)}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{
                    fontSize: '10px',
                    fontFamily: "'DM Mono', monospace",
                    padding: '3px 8px',
                    borderRadius: '10px',
                    background: route.isActive ? '#00d4aa14' : '#ef444414',
                    color: route.isActive ? '#00d4aa' : '#ef4444',
                  }}>
                    {route.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {realRoutes && canManage && (
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button type="button" className="btn btn-sm" onClick={() => openEdit(route)}>Modifier</button>
                      <button
                        type="button"
                        className={`btn btn-sm ${route.isActive ? 'btn-danger' : ''}`}
                        onClick={() => toggleActive(route)}
                      >
                        {route.isActive ? 'Désactiver' : 'Activer'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2" style={{ marginTop: '14px' }}>
        <div className="card">
          <div className="card-title">Top routes par volume</div>
          {display.length === 0 ? (
            <div className="empty-state">Aucune route configurée.</div>
          ) : (
            <div className="route-list" style={{ gap: '14px' }}>
              {display.slice(0, 4).map((r, i) => (
                <div key={r._id}>
                  <div className="route-row">
                    <div className="route-from">{r.name.split(' → ')[0] ?? r.name}</div>
                    <div className="route-arrow">→</div>
                    <div className="route-to">{r.name.split(' → ')[1] ?? ''}</div>
                  </div>
                  <div style={{ margin: '6px 0 0' }}>
                    <div style={{ height: '4px', background: '#1a2135', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${100 - i * 20}%`, height: '100%', background: i === 0 ? '#00d4aa' : i === 1 ? '#3b82f6' : '#f59e0b', borderRadius: '2px' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Statut du réseau</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '24px', color: '#00d4aa' }}>{display.filter((r) => r.isActive).length}</div>
              <div className="mini-label">Routes actives</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ fontSize: '24px', color: '#ef4444' }}>{display.filter((r) => !r.isActive).length}</div>
              <div className="mini-label">Routes inactives</div>
            </div>
          </div>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nouvelle route" onClose={() => setShowCreate(false)}>
          <form onSubmit={submitCreate}>
            <Field label="Nom de la route">
              <TextInput placeholder="ex. Paris → Lyon" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </Field>
            <div className="field-row">
              <Field label="Hub d'origine">
                <Select value={createForm.fromHubId} onChange={(e) => setCreateForm({ ...createForm, fromHubId: e.target.value })}>
                  <option value="">Choisir…</option>
                  {hubs.map((h) => (
                    <option key={h._id} value={h._id}>{h.city} ({h.code})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Hub de destination">
                <Select value={createForm.toHubId} onChange={(e) => setCreateForm({ ...createForm, toHubId: e.target.value })}>
                  <option value="">Choisir…</option>
                  {hubs.map((h) => (
                    <option key={h._id} value={h._id}>{h.city} ({h.code})</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="field-row">
              <Field label="Distance (km)">
                <NumberInput min={0} value={createForm.distance} onChange={(e) => setCreateForm({ ...createForm, distance: e.target.value })} />
              </Field>
              <Field label="Durée moyenne (min)">
                <NumberInput min={0} value={createForm.avgDuration} onChange={(e) => setCreateForm({ ...createForm, avgDuration: e.target.value })} />
              </Field>
            </div>
            <Field label="Statut">
              <Select value={createForm.isActive} onChange={(e) => setCreateForm({ ...createForm, isActive: e.target.value })}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={hubs.length < 2}>Créer la route</button>
            </div>
          </form>
        </Modal>
      )}

      {editId && (
        <Modal title="Modifier la route" onClose={() => setEditId(null)}>
          <form onSubmit={submitEdit}>
            <Field label="Nom de la route">
              <TextInput value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </Field>
            <div className="field-row">
              <Field label="Distance (km)">
                <NumberInput min={0} value={editForm.distance} onChange={(e) => setEditForm({ ...editForm, distance: e.target.value })} />
              </Field>
              <Field label="Durée moyenne (min)">
                <NumberInput min={0} value={editForm.avgDuration} onChange={(e) => setEditForm({ ...editForm, avgDuration: e.target.value })} />
              </Field>
            </div>
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