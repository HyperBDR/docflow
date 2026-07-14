import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Demo } from '../types'

export default function Dashboard() {
  const [demos, setDemos] = useState<Demo[]>([])
  const [title, setTitle] = useState('')
  const [pair, setPair] = useState<string | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => { api.demos().then(setDemos).catch(error => setError(error.message)) }, [])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    const demo = await api.createDemo(title || '未命名演示')
    navigate(`/demos/${demo.id}`)
  }

  return <main className="page">
    <div className="page-title"><div><h1>我的演示</h1><p className="muted">创建、录制和发布内部操作流程。</p></div><button className="secondary" onClick={async () => setPair((await api.pair()).code)}>连接浏览器扩展</button></div>
    {pair && <div className="pair-banner"><div><strong>扩展配对码</strong><p>在扩展弹窗中输入，10 分钟内有效。</p></div><code>{pair}</code><button className="ghost" onClick={() => setPair(null)}>关闭</button></div>}
    <form className="create-card" onSubmit={create}><input value={title} onChange={event => setTitle(event.target.value)} placeholder="新演示名称" maxLength={200} /><button className="primary">创建演示</button></form>
    {error && <div className="error">{error}</div>}
    <div className="demo-grid">
      {demos.map(demo => <Link to={`/demos/${demo.id}`} className="demo-card" key={demo.id}>
        <div className="demo-preview">{demo.status === 'published' ? '▶' : '＋'}</div>
        <div><h3>{demo.title}</h3><p>{demo.status === 'published' ? '已发布' : '草稿'} · {new Date(demo.updated_at).toLocaleDateString()}</p></div>
      </Link>)}
      {!demos.length && <div className="empty"><h3>还没有演示</h3><p>创建一个演示，然后使用扩展录制或手动上传截图。</p></div>}
    </div>
  </main>
}

