import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from './api'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import Player from './pages/Player'
import SnapshotFrame from './pages/SnapshotFrame'
import Analytics from './pages/Analytics'
import Brand from './components/Brand'

type User = { id: string; email: string }

function Auth({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api.auth(mode, email, password)
      onAuthenticated(await api.me())
    } catch (value) {
      setError(value instanceof Error ? value.message : '登录失败')
    } finally { setBusy(false) }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand brand-large"><Brand large /></div>
      <h1>{mode === 'login' ? '欢迎回来' : '创建内部账号'}</h1>
      <p className="muted">录制一次，生成交互演示与操作文档。</p>
      <form onSubmit={submit} className="stack">
        <label>邮箱<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" /></label>
        <label>密码<input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 8 位" /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}</button>
      </form>
      <button className="link-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
      </button>
    </section>
  </main>
}

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const location = useLocation()
  const isDemoDetail = location.pathname.startsWith('/demos/')
  return <div className={`app-shell ${isDemoDetail ? 'demo-detail-shell' : ''}`}>
    {!isDemoDetail && <header><Link className="brand" to="/"><Brand /></Link><div className="header-user"><span>{user.email}</span><button className="ghost" onClick={logout}>退出</button></div></header>}
    <Routes><Route path="/" element={<Dashboard />} /><Route path="/demos/:id/analytics" element={<Analytics />} /><Route path="/demos/:id" element={<Editor />} /><Route path="*" element={<Navigate to="/" />} /></Routes>
  </div>
}

export default function App() {
  const isSnapshotFrame = window.location.pathname === '/snapshot-frame'
  const isPublicPlayer = window.location.pathname.startsWith('/p/')
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => {
    if (isSnapshotFrame || isPublicPlayer) return
    api.me().then(setUser).catch(error => setUser(error instanceof ApiError && error.status === 401 ? null : null))
  }, [isSnapshotFrame, isPublicPlayer])
  if (isSnapshotFrame) return <SnapshotFrame />
  if (isPublicPlayer) return <Routes><Route path="/p/:token" element={<Player />} /></Routes>
  if (user === undefined) return <div className="center-page">正在加载 DocFlow…</div>
  return <Routes>
    <Route path="/p/:token" element={<Player />} />
    <Route path="/snapshot-frame" element={<SnapshotFrame />} />
    <Route path="/*" element={user ? <Shell user={user} logout={async () => { await api.logout(); setUser(null) }} /> : <Auth onAuthenticated={setUser} />} />
  </Routes>
}
