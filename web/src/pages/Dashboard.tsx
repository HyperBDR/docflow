import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { copyText } from '../clipboard'
import Icon from '../components/Icon'
import type { Category, Demo, Tag } from '../types'

type Dialog = 'categories' | 'move' | 'tags' | 'merge' | null

export default function Dashboard() {
  const [demos, setDemos] = useState<Demo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [title, setTitle] = useState('')
  const [pair, setPair] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [view, setView] = useState<'grid' | 'list'>(() => localStorage.getItem('docflow-library-view') === 'list' ? 'list' : 'grid')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { Promise.all([api.demos(), api.categories(), api.tags()]).then(([demoItems, categoryItems, tagItems]) => { setDemos(demoItems); setCategories(categoryItems); setTags(tagItems) }).catch(value => setError(value.message)) }, [])
  const roots = useMemo(() => categories.filter(item => !item.parent_id), [categories])
  const selectedDemos = useMemo(() => demos.filter(demo => selected.has(demo.id)), [demos, selected])
  const categoryIds = useMemo(() => {
    if (categoryFilter === 'all' || categoryFilter === 'uncategorized') return null
    const item = categories.find(category => category.id === categoryFilter)
    return new Set([categoryFilter, ...(!item?.parent_id ? categories.filter(category => category.parent_id === categoryFilter).map(category => category.id) : [])])
  }, [categories, categoryFilter])
  const filtered = useMemo(() => demos.filter(demo => {
    const text = `${demo.title} ${demo.description} ${demo.tags.map(tag => tag.name).join(' ')}`.toLowerCase()
    return (status === 'all' || demo.status === status)
      && (categoryFilter !== 'uncategorized' ? (!categoryIds || (!!demo.category_id && categoryIds.has(demo.category_id))) : !demo.category_id)
      && (tagFilter === 'all' || demo.tags.some(tag => tag.id === tagFilter))
      && text.includes(query.trim().toLowerCase())
  }), [demos, query, status, categoryFilter, categoryIds, tagFilter])

  function showError(value: unknown) { setError(value instanceof Error ? value.message : '操作失败') }
  function toggle(id: string) { setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next }) }
  function setDisplay(next: 'grid' | 'list') { setView(next); localStorage.setItem('docflow-library-view', next) }
  function categoryCount(id?: string) {
    if (!id) return demos.filter(item => !item.category_id).length
    const ids = new Set([id, ...categories.filter(item => item.parent_id === id).map(item => item.id)])
    return demos.filter(item => item.category_id && ids.has(item.category_id)).length
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    try {
      const categoryId = categories.some(item => item.id === categoryFilter) ? categoryFilter : undefined
      const demo = await api.createDemo(title || '未命名演示', categoryId)
      navigate(`/demos/${demo.id}?mode=edit`)
    } catch (value) { showError(value) }
  }
  async function remove(ids: string[]) {
    if (!ids.length || !window.confirm(`确定删除选中的 ${ids.length} 个演示吗？此操作不可撤销。`)) return
    setBusy(true); setError('')
    try { await Promise.all(ids.map(id => api.deleteDemo(id))); setDemos(current => current.filter(item => !ids.includes(item.id))); setSelected(new Set()); setNotice(`已删除 ${ids.length} 个演示。`) }
    catch (value) { showError(value) } finally { setBusy(false) }
  }
  async function duplicate(items: Demo[]) {
    if (!items.length) return
    setBusy(true); setError('')
    try { const copied = await Promise.all(items.map(item => api.duplicateDemo(item.id))); setDemos(current => [...copied, ...current]); setSelected(new Set(copied.map(item => item.id))); setNotice(`已创建 ${copied.length} 个副本。`) }
    catch (value) { showError(value) } finally { setBusy(false) }
  }
  async function share(items: Demo[]) {
    if (!items.length) return
    setBusy(true); setError('')
    try {
      const results = await Promise.allSettled(items.map(item => item.share_url ? Promise.resolve(item) : api.publish(item.id)))
      const published = results.flatMap(result => result.status === 'fulfilled' && result.value.share_url ? [result.value] : [])
      if (!published.length) throw new Error('共享链接生成失败，请确认演示中已有步骤。')
      await copyText(published.map(item => item.share_url).join('\n'))
      const updates = new Map(published.map(item => [item.id, item])); setDemos(current => current.map(item => updates.has(item.id) ? { ...item, ...updates.get(item.id)! } : item)); setNotice(`已复制 ${published.length} 个共享链接。`)
    } catch (value) { showError(value) } finally { setBusy(false) }
  }
  async function revoke(demo: Demo) {
    if (!window.confirm(`取消共享“${demo.title}”后，原链接将立即失效。是否继续？`)) return
    setBusy(true)
    try { const updated = await api.revoke(demo.id); setDemos(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item)); setNotice('已取消共享。') }
    catch (value) { showError(value) } finally { setBusy(false) }
  }

  return <main className="page resource-page library-page">
    <div className="page-title"><div><h1>我的演示</h1><p className="muted">按产品与标签组织内容，管理共享、分析和导出资源。</p></div><button className="secondary icon-button" onClick={async () => setPair((await api.pair()).code)}><Icon name="link" />连接浏览器扩展</button></div>
    {pair && <div className="pair-banner"><div><strong>扩展配对码</strong><p>在扩展弹窗中输入，10 分钟内有效。</p></div><code>{pair}</code><button className="ghost" onClick={() => setPair(null)}>关闭</button></div>}
    {error && <div className="toast error" onClick={() => setError('')}>{error}</div>}{notice && <div className="toast success" onClick={() => setNotice('')}>{notice}</div>}
    <form className="create-card" onSubmit={create}><input value={title} onChange={event => setTitle(event.target.value)} placeholder="输入新演示名称" maxLength={200} /><button className="primary icon-button"><Icon name="plus" />创建演示</button></form>

    <div className="library-layout">
      <aside className="library-sidebar">
        <div className="library-sidebar-heading"><span><Icon name="folder" />内容分类</span><button title="管理分类" onClick={() => setDialog('categories')}><Icon name="settings" size={14} /></button></div>
        <button className={categoryFilter === 'all' ? 'active' : ''} onClick={() => setCategoryFilter('all')}><span><Icon name="layout" />全部资源</span><b>{demos.length}</b></button>
        <button className={categoryFilter === 'uncategorized' ? 'active' : ''} onClick={() => setCategoryFilter('uncategorized')}><span><Icon name="folder" />未分类</span><b>{categoryCount()}</b></button>
        <div className="category-tree">{roots.map(root => <div key={root.id}>
          <button className={categoryFilter === root.id ? 'active' : ''} onClick={() => setCategoryFilter(root.id)}><span><i style={{ background: root.color }} /><span>{root.name}</span></span><b>{categoryCount(root.id)}</b></button>
          {categories.filter(item => item.parent_id === root.id).map(child => <button key={child.id} className={`category-child ${categoryFilter === child.id ? 'active' : ''}`} onClick={() => setCategoryFilter(child.id)}><span><i style={{ background: child.color }} /><span>{child.name}</span></span><b>{categoryCount(child.id)}</b></button>)}
        </div>)}</div>
        <button className="sidebar-add" onClick={() => setDialog('categories')}><Icon name="plus" />新建分类</button>
        <div className="sidebar-tags"><div><span><Icon name="tag" />标签</span><button onClick={() => { setSelected(new Set()); setDialog('tags') }}><Icon name="plus" size={13} /></button></div>{tags.slice(0, 12).map(tag => <button key={tag.id} className={tagFilter === tag.id ? 'active' : ''} onClick={() => setTagFilter(tagFilter === tag.id ? 'all' : tag.id)}><span><i style={{ background: tag.color }} />{tag.name}</span><b>{demos.filter(item => item.tags.some(value => value.id === tag.id)).length}</b></button>)}</div>
      </aside>

      <section className="library-content">
        <div className="resource-toolbar">
          <label className="select-all"><input type="checkbox" checked={Boolean(filtered.length) && filtered.every(item => selected.has(item.id))} onChange={event => setSelected(event.target.checked ? new Set(filtered.map(item => item.id)) : new Set())} />全选</label>
          <div className="search-field"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、说明或标签" /></div>
          <select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option></select>
          <div className="view-switch"><button className={view === 'grid' ? 'active' : ''} onClick={() => setDisplay('grid')} title="网格视图"><Icon name="grid" /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setDisplay('list')} title="列表视图"><Icon name="list" /></button></div>
          <span className="resource-count">{selected.size ? `已选择 ${selected.size} 项` : `共 ${filtered.length} 项`}</span>
        </div>
        {selected.size > 0 && <div className="bulk-action-bar"><span>已选择 <strong>{selected.size}</strong> 个资源</span><div>
          <button disabled={busy || selected.size !== 1} onClick={() => navigate(`/demos/${selectedDemos[0].id}?mode=edit`)}><Icon name="edit" />编辑</button>
          <button disabled={busy} onClick={() => setDialog('move')}><Icon name="folder" />移动到</button>
          <button disabled={busy} onClick={() => setDialog('tags')}><Icon name="tag" />设置标签</button>
          <button disabled={busy || selected.size < 2 || selected.size > 5} title="请选择 2–5 个资源" onClick={() => setDialog('merge')}><Icon name="move" />合并</button>
          <button disabled={busy} onClick={() => share(selectedDemos)}><Icon name="share" />共享</button><button disabled={busy} onClick={() => duplicate(selectedDemos)}><Icon name="copy" />复制</button><button className="danger" disabled={busy} onClick={() => remove([...selected])}><Icon name="delete" />删除</button>
        </div></div>}

        <div className={`demo-grid ${view === 'list' ? 'list-view' : ''}`}>
          {filtered.map(demo => <article className={`demo-card ${selected.has(demo.id) ? 'selected' : ''}`} key={demo.id}>
            <label className="card-select" title="选择资源"><input type="checkbox" checked={selected.has(demo.id)} onChange={() => toggle(demo.id)} /></label>
            <Link to={`/demos/${demo.id}`} className={`demo-preview ${demo.thumbnail_url ? 'has-image' : ''}`}>{demo.thumbnail_url ? <img src={demo.thumbnail_url} alt={`${demo.title} 缩略图`} loading="lazy" /> : <span><Icon name="image" size={38} /></span>}<em><Icon name={demo.status === 'published' ? 'play' : 'edit'} size={11} />{demo.status === 'published' ? '交互演示' : '草稿'}</em></Link>
            <div className="demo-card-body"><div className="demo-card-title"><h3 title={demo.title}>{demo.title}</h3><span className={`status ${demo.status}`}>{demo.status === 'published' ? '已发布' : '草稿'}</span></div><p>更新于 {new Date(demo.updated_at).toLocaleString()}</p><div className="demo-tags">{demo.tags.map(tag => <span key={tag.id} style={{ '--tag-color': tag.color } as React.CSSProperties}>{tag.name}</span>)}</div></div>
            <div className="card-actions"><Link to={`/demos/${demo.id}?mode=edit`} className="card-action"><Icon name="edit" />编辑</Link>{demo.share_url && <Link to={`/demos/${demo.id}/analytics`} className="card-action"><Icon name="analytics" />分析</Link>}{demo.share_url && <a href={demo.share_url} target="_blank" className="card-action"><Icon name="play" />预览</a>}<button disabled={busy} onClick={() => share([demo])}><Icon name="share" />{demo.share_url ? '复制链接' : '发布'}</button><button disabled={busy} onClick={() => duplicate([demo])}><Icon name="copy" />复制</button>{demo.share_url && <button disabled={busy} onClick={() => revoke(demo)} title="取消共享"><Icon name="unlink" /></button>}<button disabled={busy} className="danger" onClick={() => remove([demo.id])} title="删除演示"><Icon name="delete" /></button></div>
          </article>)}
          {!filtered.length && <div className="empty"><Icon name="folder" size={42} /><h3>{demos.length ? '这个分类中没有匹配资源' : '还没有演示'}</h3><p>创建演示或调整分类、状态和标签筛选。</p></div>}
        </div>
      </section>
    </div>
    {dialog === 'categories' && <CategoryDialog categories={categories} onClose={() => { setDialog(null); api.demos().then(setDemos).catch(showError) }} onChange={setCategories} onError={showError} />}
    {dialog === 'move' && <MoveDialog categories={categories} count={selected.size} onClose={() => setDialog(null)} onMove={async categoryId => { setBusy(true); try { const updates = await Promise.all(selectedDemos.map(item => api.updateDemo(item.id, { category_id: categoryId || null }))); const map = new Map(updates.map(item => [item.id, item])); setDemos(current => current.map(item => map.get(item.id) || item)); setDialog(null); setNotice('资源已移动到新分类。') } catch (value) { showError(value) } finally { setBusy(false) } }} />}
    {dialog === 'tags' && <TagDialog tags={tags} demos={selectedDemos} onClose={() => { setDialog(null); api.demos().then(setDemos).catch(showError) }} onTags={setTags} onApply={async ids => { if (!selectedDemos.length) { setDialog(null); api.demos().then(setDemos).catch(showError); return } setBusy(true); try { const updates = await Promise.all(selectedDemos.map(item => api.updateDemo(item.id, { tag_ids: ids }))); const map = new Map(updates.map(item => [item.id, item])); setDemos(current => current.map(item => map.get(item.id) || item)); setDialog(null); setNotice('标签已更新。') } catch (value) { showError(value) } finally { setBusy(false) } }} onError={showError} />}
    {dialog === 'merge' && <MergeDialog demos={selectedDemos} categories={categories} onClose={() => setDialog(null)} onMerge={async (ids, name, categoryId) => { setBusy(true); try { const merged = await api.mergeDemos(ids, name, categoryId); setDemos(current => [merged, ...current]); setSelected(new Set([merged.id])); setDialog(null); setNotice(`已生成“${merged.title}”，原资源保持不变。`) } catch (value) { showError(value) } finally { setBusy(false) } }} />}
  </main>
}

function DialogShell({ title, subtitle, icon, children, onClose }: { title: string; subtitle: string; icon: 'folder' | 'tag' | 'move'; children: React.ReactNode; onClose: () => void }) {
  return <div className="library-dialog-layer" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="library-dialog"><header><span><Icon name={icon} /></span><div><strong>{title}</strong><small>{subtitle}</small></div><button onClick={onClose}>×</button></header><div className="library-dialog-body">{children}</div></div></div>
}

function CategoryDialog({ categories, onClose, onChange, onError }: { categories: Category[]; onClose: () => void; onChange: (items: Category[]) => void; onError: (value: unknown) => void }) {
  const [name, setName] = useState(''); const [parent, setParent] = useState(''); const [color, setColor] = useState('#635bff'); const [busy, setBusy] = useState(false)
  async function add(event: React.FormEvent) { event.preventDefault(); if (!name.trim()) return; setBusy(true); try { const item = await api.createCategory(name, parent || undefined, color); onChange([...categories, item]); setName('') } catch (value) { onError(value) } finally { setBusy(false) } }
  async function rename(item: Category) { const value = window.prompt('输入新的分类名称', item.name)?.trim(); if (!value || value === item.name) return; try { const updated = await api.updateCategory(item.id, { name: value }); onChange(categories.map(value => value.id === item.id ? updated : value)) } catch (error) { onError(error) } }
  async function remove(item: Category) { if (!window.confirm(`删除“${item.name}”？其中资源会变为未分类。`)) return; try { await api.deleteCategory(item.id); const removed = new Set([item.id, ...categories.filter(value => value.parent_id === item.id).map(value => value.id)]); onChange(categories.filter(value => !removed.has(value.id))) } catch (error) { onError(error) } }
  return <DialogShell title="分类管理" subtitle="支持两级目录，可用颜色标记不同产品线" icon="folder" onClose={onClose}><form className="category-create" onSubmit={add}><input value={name} onChange={event => setName(event.target.value)} placeholder="例如：AGIOne 产品" /><select value={parent} onChange={event => setParent(event.target.value)}><option value="">一级分类</option>{categories.filter(item => !item.parent_id).map(item => <option key={item.id} value={item.id}>↳ {item.name} 下的二级分类</option>)}</select><label className="category-color" title="分类标记颜色" style={{ background: color }}><input type="color" value={color} onChange={event => setColor(event.target.value)} /></label><button className="primary" disabled={busy || !name.trim()}><Icon name="plus" />添加</button></form><div className="manage-list">{categories.map(item => <div key={item.id} className={item.parent_id ? 'child' : ''}><label className="manage-color" title="修改标记颜色" style={{ background: item.color }}><input type="color" value={item.color} onChange={async event => { try { const updated = await api.updateCategory(item.id, { color: event.target.value }); onChange(categories.map(value => value.id === item.id ? updated : value)) } catch (error) { onError(error) } }} /></label><span>{item.parent_id ? '↳ ' : ''}{item.name}</span><small>{item.parent_id ? '二级分类' : '一级分类'}</small><button onClick={() => rename(item)}><Icon name="edit" /></button><button className="danger" onClick={() => remove(item)}><Icon name="delete" /></button></div>)}{!categories.length && <p className="dialog-empty">还没有分类，先创建一个产品分类。</p>}</div></DialogShell>
}

function MoveDialog({ categories, count, onClose, onMove }: { categories: Category[]; count: number; onClose: () => void; onMove: (id: string) => void }) {
  const [value, setValue] = useState('')
  return <DialogShell title="移动资源" subtitle={`将 ${count} 个资源移动到指定分类`} icon="folder" onClose={onClose}><label>目标分类<select value={value} onChange={event => setValue(event.target.value)}><option value="">未分类</option>{categories.map(item => <option key={item.id} value={item.id}>{item.parent_id ? '　↳ ' : ''}{item.name}</option>)}</select></label><div className="dialog-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => onMove(value)}>确认移动</button></div></DialogShell>
}

function TagDialog({ tags, demos, onClose, onTags, onApply, onError }: { tags: Tag[]; demos: Demo[]; onClose: () => void; onTags: (items: Tag[]) => void; onApply: (ids: string[]) => void; onError: (value: unknown) => void }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(demos.length ? demos[0].tags.map(item => item.id) : [])); const [name, setName] = useState(''); const [color, setColor] = useState('#635bff')
  async function add() { if (!name.trim()) return; try { const tag = await api.createTag(name, color); if (!tags.some(item => item.id === tag.id)) onTags([...tags, tag]); setChosen(current => new Set([...current, tag.id])); setName('') } catch (value) { onError(value) } }
  async function removeTag(tag: Tag) { if (!window.confirm(`删除标签“${tag.name}”？资源本身不会被删除。`)) return; try { await api.deleteTag(tag.id); onTags(tags.filter(item => item.id !== tag.id)); setChosen(current => { const next = new Set(current); next.delete(tag.id); return next }) } catch (value) { onError(value) } }
  return <DialogShell title="标签管理" subtitle={demos.length ? `为 ${demos.length} 个资源统一设置标签` : '创建用于全局搜索与管理的标签'} icon="tag" onClose={onClose}><div className="tag-create"><input value={name} onChange={event => setName(event.target.value)} placeholder="新标签名称" /><label style={{ background: color }}><input type="color" value={color} onChange={event => setColor(event.target.value)} /></label><button onClick={add}><Icon name="plus" />新建</button></div><div className="tag-picker">{tags.map(tag => <div className="tag-picker-item" key={tag.id}><button className={chosen.has(tag.id) ? 'active' : ''} onClick={() => setChosen(current => { const next = new Set(current); next.has(tag.id) ? next.delete(tag.id) : next.add(tag.id); return next })}><i style={{ background: tag.color }} />{tag.name}{chosen.has(tag.id) && <Icon name="check" size={13} />}</button>{!demos.length && <button className="tag-delete" title="删除标签" onClick={() => removeTag(tag)}><Icon name="delete" size={12} /></button>}</div>)}{!tags.length && <p className="dialog-empty">输入名称创建第一个标签。</p>}</div><div className="dialog-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => onApply([...chosen])}>{demos.length ? '应用标签' : '完成'}</button></div></DialogShell>
}

function MergeDialog({ demos, categories, onClose, onMerge }: { demos: Demo[]; categories: Category[]; onClose: () => void; onMerge: (ids: string[], name: string, categoryId?: string) => void }) {
  const [items, setItems] = useState(demos); const [name, setName] = useState(`${demos[0]?.title || '演示'} · 合并版`); const [category, setCategory] = useState(demos[0]?.category_id || '')
  function move(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; setItems(next) }
  return <DialogShell title="合并演示" subtitle="原资源保持不变，按下列顺序生成一个可编辑的新演示" icon="move" onClose={onClose}><label>新演示名称<input value={name} onChange={event => setName(event.target.value)} maxLength={200} /></label><div className="merge-order"><span>步骤衔接顺序</span>{items.map((item, index) => <div key={item.id}><b>{index + 1}</b>{item.thumbnail_url ? <img src={item.thumbnail_url} /> : <span className="merge-thumb"><Icon name="image" /></span>}<div><strong>{item.title}</strong><small>{item.steps.length ? `${item.steps.length} 个步骤` : '步骤将在合并时校验'}</small></div><button disabled={!index} onClick={() => move(index, -1)}><Icon name="arrowUp" /></button><button disabled={index === items.length - 1} onClick={() => move(index, 1)}><Icon name="arrowDown" /></button></div>)}</div><label>新资源分类<select value={category} onChange={event => setCategory(event.target.value)}><option value="">沿用第一个资源 / 未分类</option>{categories.map(item => <option key={item.id} value={item.id}>{item.parent_id ? '　↳ ' : ''}{item.name}</option>)}</select></label><div className="dialog-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={!name.trim()} onClick={() => onMerge(items.map(item => item.id), name, category || undefined)}><Icon name="move" />生成合并演示</button></div></DialogShell>
}
