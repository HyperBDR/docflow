import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from './api'
import { applyLocale, normalizeLocale } from './i18n'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import Player from './pages/Player'
import SnapshotFrame from './pages/SnapshotFrame'
import Analytics from './pages/Analytics'
import Brand from './components/Brand'
import LanguageSwitcher from './components/LanguageSwitcher'
import type { User } from './types'

function Auth({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const { t, i18n } = useTranslation('auth')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api.auth(mode, email, password, normalizeLocale(i18n.language))
      const user = await api.me()
      await applyLocale(user.ui_locale)
      onAuthenticated(user)
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

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const isDemoDetail = location.pathname.startsWith('/demos/')
  return <div className={`app-shell ${isDemoDetail ? 'demo-detail-shell' : ''}`}>
    {!isDemoDetail && <header><Link className="brand" to="/"><Brand /></Link><div className="header-user"><LanguageSwitcher account /><span>{user.email}</span><button className="ghost" onClick={logout}>{t('actions.logout')}</button></div></header>}
    <Routes><Route path="/" element={<Dashboard />} /><Route path="/demos/:id/analytics" element={<Analytics />} /><Route path="/demos/:id" element={<Editor />} /><Route path="*" element={<Navigate to="/" />} /></Routes>
  </div>
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
  if (isSnapshotFrame) return <SnapshotFrame />
  if (isPublicPlayer) return <Routes><Route path="/p/:token" element={<Player />} /></Routes>
  if (user === undefined) return <div className="center-page">{t('loadingApp')}</div>
  return <Routes>
    <Route path="/p/:token" element={<Player />} />
    <Route path="/snapshot-frame" element={<SnapshotFrame />} />
    <Route path="/*" element={user ? <Shell user={user} logout={async () => { await api.logout(); setUser(null) }} /> : <Auth onAuthenticated={setUser} />} />
  </Routes>
}
