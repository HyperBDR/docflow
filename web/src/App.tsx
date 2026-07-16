import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from './api'
import { applyLocale, normalizeLocale } from './i18n'
import Editor from './pages/Editor'
import Player from './pages/Player'
import SnapshotFrame from './pages/SnapshotFrame'
import Analytics from './pages/Analytics'
import Account from './pages/Account'
import AdminShell from './pages/AdminShell'
import Invite from './pages/Invite'
import TeamSpaceSettings from './pages/TeamSpaceSettings'
import ExtensionConnect from './pages/ExtensionConnect'
import Brand from './components/Brand'
import { LAST_WORKSPACE_KEY } from './components/AccountMenu'
import LanguageSwitcher from './components/LanguageSwitcher'
import WorkspaceShell from './pages/workspace/WorkspaceShell'
import type { User } from './types'

function Auth({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const { t, i18n } = useTranslation('auth')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api.auth(mode, email, password, normalizeLocale(i18n.language))
      const user = await api.me()
      await applyLocale(user.ui_locale)
      onAuthenticated(user)
      const resumeExtensionConnect = location.pathname === '/extension/connect'
      navigate(resumeExtensionConnect ? `${location.pathname}${location.search}` : user.role === 'admin' && localStorage.getItem(LAST_WORKSPACE_KEY) === 'admin' ? '/admin' : '/')
    } catch (value) {
      setError(value instanceof Error ? value.message : t('loginFailed'))
    } finally { setBusy(false) }
  }

  return <main className="auth-shell">
    <div className="auth-language"><LanguageSwitcher /></div>
    <section className="auth-card">
      <div className="brand brand-large"><Brand large /></div>
      <h1>{mode === 'login' ? t('loginTitle') : t('registerTitle')}</h1>
      <p className="muted">{t('tagline')}</p>
      <form onSubmit={submit} className="stack">
        <label>{t('email')}<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" /></label>
        <label>{t('password')}<input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder={t('passwordHint')} /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? t('waiting') : mode === 'login' ? t('login') : t('register')}</button>
      </form>
      <button className="link-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? t('toRegister') : t('toLogin')}
      </button>
    </section>
  </main>
}

function AuthenticatedApp({ user, onUserChange, logout }: { user: User; onUserChange: (user: User) => void; logout: () => void }) {
  return <Routes>
    <Route path="/admin/*" element={user.role === 'admin' ? <AdminShell user={user} onUserChange={onUserChange} logout={logout} /> : <Navigate to="/" />} />
    <Route path="/account/*" element={<Account user={user} onUserChange={onUserChange} onPasswordChanged={logout} />} />
    <Route path="/spaces/:id" element={<TeamSpaceSettings user={user} onUserChange={onUserChange} logout={logout} />} />
    <Route path="/extension/connect" element={<ExtensionConnect />} />
    <Route path="/demos/:id/analytics" element={<Analytics />} />
    <Route path="/demos/:id" element={<Editor />} />
    <Route path="/*" element={<WorkspaceShell user={user} onUserChange={onUserChange} logout={logout} />} />
  </Routes>
}

export default function App() {
  const { t } = useTranslation('auth')
  const isSnapshotFrame = window.location.pathname === '/snapshot-frame'
  const isPublicPlayer = window.location.pathname.startsWith('/p/')
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => {
    if (isSnapshotFrame || isPublicPlayer) return
    api.me().then(async value => { await applyLocale(value.ui_locale); setUser(value) }).catch(error => setUser(error instanceof ApiError && error.status === 401 ? null : null))
  }, [isSnapshotFrame, isPublicPlayer])
  useEffect(() => {
    const update = (event: Event) => setUser((event as CustomEvent<User>).detail)
    window.addEventListener('docflow:user-updated', update)
    return () => window.removeEventListener('docflow:user-updated', update)
  }, [])
  if (isSnapshotFrame) return <SnapshotFrame />
  if (isPublicPlayer) return <Routes><Route path="/p/:token" element={<Player />} /></Routes>
  if (user === undefined) return <div className="center-page">{t('loadingApp')}</div>
  return <Routes>
    <Route path="/p/:token" element={<Player />} />
    <Route path="/snapshot-frame" element={<SnapshotFrame />} />
    <Route path="/invite/:token" element={<Invite user={user || null} onAuthenticated={setUser} />} />
    <Route path="/*" element={user ? <AuthenticatedApp user={user} onUserChange={setUser} logout={async () => { try { await api.logout() } finally { setUser(null) } }} /> : <Auth onAuthenticated={setUser} />} />
  </Routes>
}
