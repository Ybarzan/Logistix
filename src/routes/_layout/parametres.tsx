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
