import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Field, Select, TextInput } from '../../components/form'
import { can, roleLabel } from '../../components/rbac'
import { formatDateTime } from '../../components/shipmentMeta'
import type { Role } from '../../components/rbac'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/_layout/parametres')({
  head: () => ({ meta: [{ title: 'Paramètres — Logistix' }] }),
  component: SettingsPage,
})

const ROLES: Array<Role> = ['admin', 'manager', 'operator', 'viewer']

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Une erreur est survenue'
  // Les erreurs Convex arrivent préfixées du contexte serveur : on garde le message utile.
  const match = raw.match(/Uncaught Error: (.+?)(\n|$)/)
  return match ? match[1] : raw
}

function SettingsPage() {
  const { data: currentUser } = useSuspenseQuery(convexQuery(api.organizations.currentUser, {}))
  const { data: members } = useSuspenseQuery(convexQuery(api.organizations.listMembers, {}))
  const { data: invitations } = useSuspenseQuery(convexQuery(api.organizations.listInvitations, {}))
  const rename = useMutation(api.organizations.rename)
  const updateRole = useMutation(api.organizations.updateUserRole)
  const invite = useMutation(api.organizations.invite)
  const revoke = useMutation(api.organizations.revokeInvitation)
  const isAdmin = can(currentUser?.role, 'admin')

  const [orgName, setOrgName] = useState(currentUser?.org?.name ?? '')
  const [inviteForm, setInviteForm] = useState<{ email: string; role: Role }>({ email: '', role: 'operator' })
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (success) setNotice(success)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submitRename = (e: FormEvent) => {
    e.preventDefault()
    void run(() => rename({ name: orgName }), 'Organisation renommée.')
  }

  const submitInvite = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const { token } = await invite(inviteForm)
      setInviteLink(`${window.location.origin}/login?invite=${token}`)
      setInviteForm({ email: '', role: 'operator' })
    })
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">Paramètres</div>
        <div className="page-sub">
          {currentUser?.org?.name} · {members.length} membre(s)
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Organisation</div>
          {isAdmin ? (
            <form onSubmit={submitRename}>
              <Field label="Nom">
                <TextInput value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              </Field>
              <button type="submit" className="btn btn-primary" disabled={busy || orgName.trim() === currentUser?.org?.name}>
                Enregistrer
              </button>
            </form>
          ) : (
            <div className="info-list">
              <div className="info-row">
                <span className="info-label">Nom</span>
                <span className="info-value">{currentUser?.org?.name}</span>
              </div>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="card">
            <div className="card-title">Inviter un collaborateur</div>
            <form onSubmit={submitInvite}>
              <div className="field-row">
                <Field label="E-mail">
                  <TextInput
                    type="email"
                    required
                    placeholder="prenom@entreprise.fr"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  />
                </Field>
                <Field label="Rôle">
                  <Select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </Select>
                </Field>
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>Générer le lien</button>
            </form>
            {inviteLink && (
              <div className="invite-link">
                <div className="field-label">Lien à transmettre (usage unique, lié à cet e-mail)</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="input" readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => setNotice('Lien copié.'))}
                  >
                    Copier
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '14px' }}>
        <div className="card-title">Membres</div>
        <table className="data-table">
          <thead>
            <tr><th>Nom</th><th>E-mail</th><th>Rôle</th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m._id}>
                <td>{m.name ?? '—'}{m._id === currentUser?._id ? ' (vous)' : ''}</td>
                <td className="mono">{m.email ?? '—'}</td>
                <td>
                  {isAdmin ? (
                    <Select
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        void run(
                          () => updateRole({ userId: m._id as Id<'users'>, role: e.target.value as Role }),
                          'Rôle mis à jour.',
                        )
                      }
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </Select>
                  ) : (
                    roleLabel(m.role)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FleethubCard isAdmin={isAdmin} canSync={can(currentUser?.role, 'operator')} />

      {isAdmin && invitations.length > 0 && (
        <div className="card" style={{ marginTop: '14px' }}>
          <div className="card-title">Invitations en attente</div>
          <table className="data-table">
            <thead>
              <tr><th>E-mail</th><th>Rôle</th><th>Envoyée le</th><th /></tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv._id}>
                  <td className="mono">{inv.email}</td>
                  <td>{roleLabel(inv.role)}</td>
                  <td>{formatDateTime(inv.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void run(() => revoke({ invitationId: inv._id }), 'Invitation révoquée.')}
                    >
                      Révoquer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function FleethubCard({ isAdmin, canSync }: { isAdmin: boolean; canSync: boolean }) {
  const { data: config } = useSuspenseQuery(convexQuery(api.fleethub.getConfig, {}))
  const save = useMutation(api.fleethub.saveConfig)
  const syncNow = useMutation(api.fleethub.syncNow)
  const [form, setForm] = useState({
    baseUrl: config?.baseUrl ?? 'http://host.docker.internal:8888',
    apiKey: '',
    enabled: config?.enabled ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await save({
        baseUrl: form.baseUrl,
        enabled: form.enabled,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      })
      setForm({ ...form, apiKey: '' })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: '14px' }}>
      <div className="card-title">
        Intégration fleet-hub <span className="card-tag">GPS temps réel</span>
      </div>
      <div className="page-sub" style={{ marginBottom: '12px' }}>
        Positions réelles des camions affectés aux expéditions, synchronisées toutes les 2 minutes
        via la clé de partage fleet-hub du transporteur (fleet-hub → Marketplace → « Activer le partage »).
      </div>
      {error && <div className="auth-error">{error}</div>}
      {isAdmin && (
        <form onSubmit={submit}>
          <div className="field-row">
            <Field label="URL fleet-hub">
              <TextInput value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </Field>
            <Field label={config ? `Clé de partage (actuelle ${config.keyHint})` : 'Clé de partage'}>
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder={config ? 'Laisser vide pour conserver' : 'X-Marketplace-Key'}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
            </Field>
          </div>
          <label className="field-label" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Synchronisation active
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>Enregistrer et synchroniser</button>
        </form>
      )}
      {config && (
        <div className="status-line">
          {config.companyName ? <>Société : <strong>{config.companyName}</strong> · </> : null}
          {config.complianceScore !== undefined ? <>conformité {config.complianceScore}% · </> : null}
          {config.vehicleCount} camion(s) disponible(s)
          <br />
          Dernière synchro : {config.lastSyncAt ? formatDateTime(config.lastSyncAt) : 'jamais'}
          {config.lastError && <><br /><span className="err">Erreur : {config.lastError}</span></>}
          {canSync && (
            <div style={{ marginTop: '8px' }}>
              <button type="button" className="btn btn-sm" onClick={() => void syncNow({}).catch((err: unknown) => setError(errorMessage(err)))}>
                Synchroniser maintenant
              </button>
            </div>
          )}
        </div>
      )}
      {!config && !isAdmin && <div className="empty-state">Non configurée. Demandez à un administrateur.</div>}
    </div>
  )
}
