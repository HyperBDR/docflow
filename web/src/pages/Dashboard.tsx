import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { copyText } from '../clipboard'
import Icon from '../components/Icon'
import type { Demo } from '../types'

export default function Dashboard() {
  const [demos, setDemos] = useState<Demo[]>([])
  const [title, setTitle] = useState('')
  const [pair, setPair] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  useEffect(() => { api.demos().then(setDemos).catch(error => setError(error.message)) }, [])
  const filtered = useMemo(() => demos.filter(demo => (status === 'all' || demo.status === status) && demo.title.toLowerCase().includes(query.trim().toLowerCase())), [demos, query, status])
  const selectedDemos = useMemo(() => demos.filter(demo => selected.has(demo.id)), [demos, selected])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    const demo = await api.createDemo(title || '未命名演示')
    navigate(`/demos/${demo.id}`)
  }

  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  async function remove(ids: string[]) {
    if (!ids.length || !window.confirm(`确定删除选中的 ${ids.length} 个演示吗？此操作不可撤销。`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await Promise.all(ids.map(id => api.deleteDemo(id)))
      setDemos(current => current.filter(item => !ids.includes(item.id)))
      setSelected(new Set()); setNotice(`已删除 ${ids.length} 个演示。`)
    } catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }

  async function duplicate(items: Demo[]) {
    if (!items.length) return
    setBusy(true); setError(''); setNotice('')
    try {
      const copied = await Promise.all(items.map(item => api.duplicateDemo(item.id)))
      setDemos(current => [...copied, ...current])
      setSelected(new Set(copied.map(item => item.id)))
      setNotice(items.length === 1 ? `已复制“${items[0].title}”。` : `已创建 ${items.length} 个副本。`)
    } catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }

  async function share(items: Demo[]) {
    if (!items.length) return
    setBusy(true); setError(''); setNotice('')
    try {
      const results = await Promise.allSettled(items.map(item => item.share_url ? Promise.resolve(item) : api.publish(item.id)))
      const published = results.flatMap(result => result.status === 'fulfilled' && result.value.share_url ? [result.value] : [])
      const failed = results.length - published.length
      if (!published.length) {
        const reason = results.find(result => result.status === 'rejected')
        throw reason?.status === 'rejected' ? reason.reason : new Error('共享链接生成失败')
      }
      await copyText(published.map(item => item.share_url).join('\n'))
      const updates = new Map(published.map(item => [item.id, item]))
      setDemos(current => current.map(item => updates.has(item.id) ? { ...item, ...updates.get(item.id)! } : item))
      setNotice(failed ? `已复制 ${published.length} 个共享链接，${failed} 个演示发布失败。` : `已复制 ${published.length} 个共享链接。`)
      if (failed) setError('空演示或异常资源无法发布，请进入编辑页检查。')
    } catch (value) { setError(value instanceof Error ? value.message : '共享失败') } finally { setBusy(false) }
  }

  async function revoke(demo: Demo) {
    if (!window.confirm(`取消共享“${demo.title}”后，原链接将立即失效。是否继续？`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const updated = await api.revoke(demo.id)
      setDemos(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))
      setNotice('已取消共享，原公开链接已失效。')
    } catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }

  return <main className="page resource-page">
    <div className="page-title"><div><h1>我的演示</h1><p className="muted">集中管理 HTML 演示、共享链接和导出资源。</p></div><button className="secondary icon-button" onClick={async () => setPair((await api.pair()).code)}><Icon name="link" />连接浏览器扩展</button></div>
    {pair && <div className="pair-banner"><div><strong>扩展配对码</strong><p>在扩展弹窗中输入，10 分钟内有效。</p></div><code>{pair}</code><button className="ghost" onClick={() => setPair(null)}>关闭</button></div>}
    {error && <div className="toast error" onClick={() => setError('')}>{error}</div>}{notice && <div className="toast success" onClick={() => setNotice('')}>{notice}</div>}
    <form className="create-card" onSubmit={create}><input value={title} onChange={event => setTitle(event.target.value)} placeholder="输入新演示名称" maxLength={200} /><button className="primary icon-button"><Icon name="plus" />创建演示</button></form>

    <div className="resource-toolbar">
      <label className="select-all"><input type="checkbox" checked={Boolean(filtered.length) && filtered.every(item => selected.has(item.id))} onChange={event => setSelected(event.target.checked ? new Set(filtered.map(item => item.id)) : new Set())} />全选</label>
      <div className="search-field"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索演示" /></div>
      <select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option></select>
      <span className="resource-count">{selected.size ? `已选择 ${selected.size} 项` : `共 ${demos.length} 项`}</span>
      {selected.size > 0 && <div className="selection-actions">
        <button className="icon-button" disabled={busy || selected.size !== 1} title={selected.size === 1 ? '编辑选中的演示' : '编辑操作一次只能选择一个演示'} onClick={() => navigate(`/demos/${selectedDemos[0].id}`)}><Icon name="edit" />编辑</button>
        <button className="icon-button" disabled={busy} onClick={() => share(selectedDemos)}><Icon name="share" />共享</button>
        <button className="icon-button" disabled={busy} onClick={() => duplicate(selectedDemos)}><Icon name="copy" />复制</button>
        <button className="danger icon-button" disabled={busy} onClick={() => remove([...selected])}><Icon name="delete" />删除</button>
      </div>}
    </div>

    <div className="demo-grid">
      {filtered.map(demo => <article className={`demo-card ${selected.has(demo.id) ? 'selected' : ''}`} key={demo.id}>
        <label className="card-select" title="选择资源"><input type="checkbox" checked={selected.has(demo.id)} onChange={() => toggle(demo.id)} /></label>
        <Link to={`/demos/${demo.id}`} className={`demo-preview ${demo.thumbnail_url ? 'has-image' : ''}`}>
          {demo.thumbnail_url ? <img src={demo.thumbnail_url} alt={`${demo.title} 缩略图`} loading="lazy" /> : <span><Icon name="image" size={38} /></span>}
          <em><Icon name={demo.status === 'published' ? 'play' : 'edit'} size={11} />{demo.status === 'published' ? '交互演示' : '草稿'}</em>
        </Link>
        <div className="demo-card-body"><div className="demo-card-title"><h3 title={demo.title}>{demo.title}</h3><span className={`status ${demo.status}`}>{demo.status === 'published' ? '已发布' : '草稿'}</span></div><p>更新于 {new Date(demo.updated_at).toLocaleString()}</p></div>
        <div className="card-actions">
          <Link to={`/demos/${demo.id}`} className="card-action"><Icon name="edit" />编辑</Link>
          {demo.share_url && <a href={demo.share_url} target="_blank" className="card-action"><Icon name="play" />预览</a>}
          <button disabled={busy} onClick={() => share([demo])}><Icon name="share" />{demo.share_url ? '复制链接' : '发布共享'}</button>
          <button disabled={busy} onClick={() => duplicate([demo])}><Icon name="copy" />复制</button>
          {demo.share_url && <button disabled={busy} onClick={() => revoke(demo)} title="取消共享"><Icon name="unlink" /></button>}
          <button disabled={busy} className="danger" onClick={() => remove([demo.id])} title="删除演示"><Icon name="delete" /></button>
        </div>
      </article>)}
      {!filtered.length && <div className="empty"><Icon name="image" size={42} /><h3>{demos.length ? '没有匹配的演示' : '还没有演示'}</h3><p>{demos.length ? '尝试修改搜索条件或状态筛选。' : '创建一个演示，然后使用 HTML Cloning 模式录制。'}</p></div>}
    </div>
  </main>
}
