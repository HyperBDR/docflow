import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from './api'
import { applyLocale } from './i18n'
import Editor from './pages/Editor'
import Player from './pages/Player'
import SnapshotFrame from './pages/SnapshotFrame'
import Analytics from './pages/Analytics'
import Account from './pages/Account'
import AdminShell from './pages/AdminShell'
import Invite from './pages/Invite'
import TeamSpaceSettings from './pages/TeamSpaceSettings'
import ExtensionConnect from './pages/ExtensionConnect'
import AuthPage from './components/auth/AuthPage'
import WorkspaceShell from './pages/workspace/WorkspaceShell'
import type { User } from './types'
import ExtensionUpdateNotice from './components/ExtensionUpdateNotice'

function AuthenticatedApp({ user, onUserChange, logout }: { user: User; onUserChange: (user: User) => void; logout: () => void }) {
  return <><ExtensionUpdateNotice /><Routes>
    <Route path="/admin/*" element={user.role === 'admin' ? <AdminShell user={user} onUserChange={onUserChange} logout={logout} /> : <Navigate to="/" />} />
    <Route path="/account/*" element={<Account user={user} onUserChange={onUserChange} onPasswordChanged={logout} />} />
    <Route path="/spaces/:id" element={<TeamSpaceSettings user={user} onUserChange={onUserChange} logout={logout} />} />
    <Route path="/extension/connect" element={<ExtensionConnect />} />
    <Route path="/demos/:id/analytics" element={<Analytics />} />
    <Route path="/demos/:id" element={<Editor />} />
    <Route path="/*" element={<WorkspaceShell user={user} onUserChange={onUserChange} logout={logout} />} />
  </Routes></>
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
    <Route path="/*" element={user ? <AuthenticatedApp user={user} onUserChange={setUser} logout={async () => { try { await api.logout() } finally { setUser(null) } }} /> : <AuthPage onAuthenticated={setUser} />} />
  </Routes>
}
