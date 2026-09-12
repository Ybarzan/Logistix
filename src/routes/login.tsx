import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Connexion — Logistix' }] }),
  component: LoginPage,
})

type Mode = 'signIn' | 'signUp'

function LoginPage() {
  const { isAuthenticated } = useConvexAuth()
  const { signIn } = useAuthActions()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('signIn')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: '/' })
    }
  }, [isAuthenticated, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'signUp') {
        await signIn('password', {
          email,
          password,
          name,
          flow: 'signUp',
        })
      } else {
        await signIn('password', { email, password, flow: 'signIn' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-logo">
          Logistix<span>.</span>
        </div>
        <div className="auth-sub">Plateforme de supervision logistique</div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${mode === 'signIn' ? ' active' : ''}`}
            onClick={() => setMode('signIn')}
          >
            Connexion
          </button>
          <button
            type="button"
            className={`auth-tab${mode === 'signUp' ? ' active' : ''}`}
            onClick={() => setMode('signUp')}
          >
            Inscription
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'signUp' && (
            <div className="auth-field">
              <label className="auth-label" htmlFor="name">
                Nom
              </label>
              <input
                id="name"
                className="auth-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Camille Martin"
                autoComplete="name"
                required
              />
            </div>
          )}

          <div className="auth-field">
            <label className="auth-label" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="camille@logistix.app"
              autoComplete="email"
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={submitting}>
            {submitting
              ? 'En cours…'
              : mode === 'signUp'
                ? 'Créer mon compte'
                : 'Se connecter'}
          </button>
        </form>

        <div className="auth-hint">
          {mode === 'signUp'
            ? 'Le premier compte rattache l’organisation de démo.'
            : 'Le démo : créez un compte puis connectez-vous.'}
        </div>
        <div className="auth-live">
          <div className="dot-live" />
          Live sync
        </div>
      </div>
    </div>
  )
}