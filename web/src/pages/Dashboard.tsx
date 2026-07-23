import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { copyText } from '../clipboard'
import { formatDate } from '../i18n'
import Icon from '../components/Icon'
import SpaceTransferDialog from '../components/SpaceTransferDialog'
import { useToast } from '../components/toast'
import type { Category, Demo, Tag } from '../types'
import type { QuotaActionKey, WorkspaceCapabilities } from '../workspace/types'
import { quotaAllowed, quotaGuardTitle } from '../quota/guards'

type Dialog = 'categories' | 'move' | 'tags' | 'merge' | null

export default function Dashboard() {
  const { t, i18n } = useTranslation('dashboard')
  const [demos, setDemos] = useState<Demo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [view, setView] = useState<'grid' | 'list'>(() => localStorage.getItem('docflow-library-view') === 'list' ? 'list' : 'grid')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [tagTargets, setTagTargets] = useState<Demo[] | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [spaceTransferTarget, setSpaceTransferTarget] = useState<Demo | null>(null)
  const [busy, setBusy] = useState(false)
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities | null>(null)
  const navigate = useNavigate()
  const toast = useToast()

  const refreshCapabilities = useCallback((force = false) => api.quotaCapabilities(undefined, undefined, { force }).then(value => { setCapabilities(value); return value }), [])
  useEffect(() => { Promise.all([api.demos(), api.categories(), api.tags()]).then(([demoItems, categoryItems, tagItems]) => { setDemos(demoItems); setCategories(categoryItems); setTags(tagItems) }).catch(showError); void refreshCapabilities().catch(() => undefined) }, [refreshCapabilities])
  useEffect(() => { const refresh=()=>{if(document.visibilityState==='visible')void refreshCapabilities().catch(()=>undefined)},timer=window.setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh)} }, [refreshCapabilities])
  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenu])
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

  function showError(value: unknown) { toast.error(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
  const can=(action:QuotaActionKey)=>quotaAllowed(capabilities,action)
  const quotaTitle=(action:QuotaActionKey)=>quotaGuardTitle(capabilities,action,t,i18n.language)
  async function guard(action:QuotaActionKey){let live=capabilities;try{live=await refreshCapabilities(true)}catch{/* API mutation remains authoritative */}if(quotaAllowed(live,action))return true;toast.warning(quotaGuardTitle(live,action,t,i18n.language));return false}
  function toggle(id: string) { setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next }) }
  function setDisplay(next: 'grid' | 'list') { setView(next); localStorage.setItem('docflow-library-view', next) }
  function categoryCount(id?: string) {
    if (!id) return demos.filter(item => !item.category_id).length
    const ids = new Set([id, ...categories.filter(item => item.parent_id === id).map(item => item.id)])
    return demos.filter(item => item.category_id && ids.has(item.category_id)).length
  }

  async function remove(ids: string[]) {
    if (!ids.length || !window.confirm(t('messages.deleteConfirm', { count: ids.length }))) return
    setBusy(true)
    try { await Promise.all(ids.map(id => api.deleteDemo(id))); setDemos(current => current.filter(item => !ids.includes(item.id))); setSelected(new Set()); void refreshCapabilities(true); toast.success(t('messages.deleted', { count: ids.length })) }
    catch (value) { showError(value) } finally { setBusy(false) }
  }
  async function duplicate(items: Demo[]) {
    if (!items.length) return
    if(!await guard('create_resource'))return
    setBusy(true)
    try { const copied = await Promise.all(items.map(item => api.duplicateDemo(item.id))); setDemos(current => [...copied, ...current]); setSelected(new Set(copied.map(item => item.id))); void refreshCapabilities(true); toast.success(t('messages.duplicated', { count: copied.length })) }
    catch (value) { showError(value) } finally { setBusy(false) }
  }
  async function share(items: Demo[]) {
    if (!items.length) return
    if(items.some(item=>!item.share_url)&&!await guard('create_share'))return
    setBusy(true)
    try {
      const results = await Promise.allSettled(items.map(item => item.share_url ? Promise.resolve(item) : api.publish(item.id)))
      const published = results.flatMap(result => result.status === 'fulfilled' && result.value.share_url ? [result.value] : [])
      if (!published.length) throw new Error(t('messages.shareFailed'))
      await copyText(published.map(item => item.share_url).join('\n'))
      const updates = new Map(published.map(item => [item.id, item])); setDemos(current => current.map(item => updates.has(item.id) ? { ...item, ...updates.get(item.id)! } : item)); void refreshCapabilities(true); toast.success(t('messages.linksCopied', { count: published.length }))
    } catch (value) { showError(value) } finally { setBusy(false) }
  }
  async function revoke(demo: Demo) {
    if (!window.confirm(t('messages.revokeConfirm', { title: demo.title }))) return
    setBusy(true)
    try { const updated = await api.revoke(demo.id); setDemos(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item)); void refreshCapabilities(true); toast.success(t('messages.revoked')) }
    catch (value) { showError(value) } finally { setBusy(false) }
  }

  return <main className={`page resource-page library-page ${selected.size ? 'has-bulk-selection' : ''}`}>
    <div className="page-title"><div><h1>{t('title')}</h1><p className="muted">{t('subtitle')}</p></div></div>

    <div className="library-layout">
      <aside className="library-sidebar">
        <div className="library-sidebar-heading"><span><Icon name="folder" />{t('categories')}</span><button title={t('manageCategories')} onClick={() => setDialog('categories')}><Icon name="settings" size={14} /></button></div>
        <button className={categoryFilter === 'all' ? 'active' : ''} onClick={() => setCategoryFilter('all')}><span><Icon name="layout" />{t('allResources')}</span><b>{demos.length}</b></button>
        <button className={categoryFilter === 'uncategorized' ? 'active' : ''} onClick={() => setCategoryFilter('uncategorized')}><span><Icon name="folder" />{t('uncategorized')}</span><b>{categoryCount()}</b></button>
        <div className="category-tree">{roots.map(root => <div key={root.id}>
          <button className={categoryFilter === root.id ? 'active' : ''} onClick={() => setCategoryFilter(root.id)}><span><i style={{ background: root.color }} /><span>{root.name}</span></span><b>{categoryCount(root.id)}</b></button>
          {categories.filter(item => item.parent_id === root.id).map(child => <button key={child.id} className={`category-child ${categoryFilter === child.id ? 'active' : ''}`} onClick={() => setCategoryFilter(child.id)}><span><i style={{ background: child.color }} /><span>{child.name}</span></span><b>{categoryCount(child.id)}</b></button>)}
        </div>)}</div>
        <button className="sidebar-add" onClick={() => setDialog('categories')}><Icon name="plus" />{t('newCategory')}</button>
        <div className="sidebar-tags"><div><span><Icon name="tag" />{t('tags')}</span><button onClick={() => { setSelected(new Set()); setTagTargets([]); setDialog('tags') }}><Icon name="plus" size={13} /></button></div>{tags.slice(0, 12).map(tag => <button key={tag.id} className={tagFilter === tag.id ? 'active' : ''} onClick={() => setTagFilter(tagFilter === tag.id ? 'all' : tag.id)}><span><i style={{ background: tag.color }} />{tag.name}</span><b>{demos.filter(item => item.tags.some(value => value.id === tag.id)).length}</b></button>)}</div>
      </aside>

      <section className="library-content">
        <div className="resource-toolbar">
          <label className="select-all"><input type="checkbox" checked={Boolean(filtered.length) && filtered.every(item => selected.has(item.id))} onChange={event => setSelected(event.target.checked ? new Set(filtered.map(item => item.id)) : new Set())} />{t('selectAll')}</label>
          <div className="search-field"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} /></div>
          <select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">{t('allStatuses')}</option><option value="draft">{t('common:status.draft')}</option><option value="published">{t('common:status.published')}</option></select>
          <div className="view-switch"><button className={view === 'grid' ? 'active' : ''} onClick={() => setDisplay('grid')} title={t('gridView')}><Icon name="grid" /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setDisplay('list')} title={t('listView')}><Icon name="list" /></button></div>
          <span className="resource-count">{selected.size ? t('selectedCount', { count: selected.size }) : t('totalCount', { count: filtered.length })}</span>
        </div>
        {selected.size > 0 && <div className="bulk-action-bar"><span>{t('selectedResources', { count: selected.size })}</span><div>
          <button disabled={busy || selected.size !== 1} onClick={() => navigate(`/demos/${selectedDemos[0].id}?mode=edit`)}><Icon name="edit" />{t('common:actions.edit')}</button>
          <button disabled={busy} onClick={() => setDialog('move')}><Icon name="folder" />{t('moveTo')}</button>
          <button disabled={busy || selected.size !== 1} onClick={() => setSpaceTransferTarget(selectedDemos[0])}><Icon name="move" />{t('transferSpace')}</button>
          <button disabled={busy} onClick={() => { setTagTargets(null); setDialog('tags') }}><Icon name="tag" />{t('setTags')}</button>
          <button disabled={busy || selected.size < 2 || selected.size > 5 || !can('create_resource')} title={!can('create_resource')?quotaTitle('create_resource'):t('mergeHint')} onClick={() => setDialog('merge')}><Icon name="move" />{t('merge')}</button>
          <button disabled={busy || (selectedDemos.some(item=>!item.share_url)&&!can('create_share'))} title={selectedDemos.some(item=>!item.share_url)&&!can('create_share')?quotaTitle('create_share'):''} onClick={() => share(selectedDemos)}><Icon name="share" />{t('common:actions.share')}</button><button disabled={busy || !can('create_resource')} title={!can('create_resource')?quotaTitle('create_resource'):''} onClick={() => duplicate(selectedDemos)}><Icon name="copy" />{t('common:actions.copy')}</button><button className="danger" disabled={busy} onClick={() => remove([...selected])}><Icon name="delete" />{t('common:actions.delete')}</button>
        </div><button className="bulk-selection-clear" title={t('clearSelection')} aria-label={t('clearSelection')} onClick={() => setSelected(new Set())}>×</button></div>}

        <div className={`demo-grid ${view === 'list' ? 'list-view' : ''}`}>
          {filtered.map(demo => <article className={`demo-card ${selected.has(demo.id) ? 'selected' : ''} ${openMenu === demo.id ? 'menu-open' : ''}`} key={demo.id}>
            <label className="card-select" title={t('selectResource')}><input type="checkbox" checked={selected.has(demo.id)} onChange={() => toggle(demo.id)} /></label>
            <Link to={`/demos/${demo.id}`} className={`demo-preview ${demo.thumbnail_url ? 'has-image' : ''}`}>{demo.thumbnail_url ? <img src={demo.thumbnail_url} alt={t('thumbnailAlt', { title: demo.title })} loading="lazy" /> : <span><Icon name="image" size={38} /></span>}<em><Icon name={demo.status === 'published' ? 'play' : 'edit'} size={11} />{demo.status === 'published' ? t('interactiveDemo') : t('common:status.draft')}</em></Link>
            <div className="card-quick-actions">
              <button disabled={busy} title={t('setTags')} aria-label={t('setDemoTags', { title: demo.title })} onClick={() => { setTagTargets([demo]); setDialog('tags') }}><Icon name="tag" /></button>
              <Link to={`/demos/${demo.id}?mode=edit`} title={t('common:actions.edit')} aria-label={t('editDemo', { title: demo.title })}><Icon name="edit" /></Link>
              <button disabled={busy || (!demo.share_url&&!can('create_share'))} title={!demo.share_url&&!can('create_share')?quotaTitle('create_share'):demo.share_url ? t('copyShare') : t('publishShare')} aria-label={demo.share_url ? t('copyDemoShare', { title: demo.title }) : t('publishDemoShare', { title: demo.title })} onClick={() => share([demo])}><Icon name="share" /></button>
            </div>
            <div className="demo-card-body"><div className="demo-card-title"><h3 title={demo.title}>{demo.title}</h3><span className={`status ${demo.status}`}>{t(`common:status.${demo.status}`)}</span></div><p>{t('common:date.updatedAt', { date: formatDate(demo.updated_at) })}</p><div className="demo-card-recorder" title={demo.created_by.email}><span className="demo-card-recorder-icon"><Icon name="record" size={12} /></span><span>{t('recordedBy', { name: demo.created_by.name || demo.created_by.email.split('@')[0] })}</span></div><div className="demo-tags">{demo.tags.map(tag => <span key={tag.id} style={{ '--tag-color': tag.color } as React.CSSProperties}>{tag.name}</span>)}</div></div>
            <button className="card-more-trigger" title={t('common:actions.more')} aria-label={t('openMore', { title: demo.title })} onClick={event => { event.stopPropagation(); setOpenMenu(current => current === demo.id ? null : demo.id) }}><Icon name="more" /></button>
            {openMenu === demo.id && <div className="card-more-menu" onClick={event => event.stopPropagation()}>
              <div className="card-more-heading"><Icon name="settings" size={13} />{t('common:actions.more')}</div>
              {demo.share_url && <Link to={`/demos/${demo.id}/analytics`} onClick={() => setOpenMenu(null)}><Icon name="analytics" />{t('analytics')}</Link>}
              {demo.share_url && <a href={demo.share_url} target="_blank" rel="noreferrer" onClick={() => setOpenMenu(null)}><Icon name="play" />{t('openPreview')}</a>}
              <button disabled={busy || !can('create_resource')} title={!can('create_resource')?quotaTitle('create_resource'):''} onClick={() => { setOpenMenu(null); duplicate([demo]) }}><Icon name="copy" />{t('duplicate')}</button>
              <button disabled={busy} onClick={() => { setOpenMenu(null); setSpaceTransferTarget(demo) }}><Icon name="move" />{t('transferSpace')}</button>
              {demo.share_url && <button disabled={busy} onClick={() => { setOpenMenu(null); revoke(demo) }}><Icon name="unlink" />{t('revoke')}</button>}
              <button disabled={busy} className="danger" onClick={() => { setOpenMenu(null); remove([demo.id]) }}><Icon name="delete" />{t('deleteDemo')}</button>
            </div>}
          </article>)}
          {!filtered.length && <div className="empty"><Icon name="folder" size={42} /><h3>{demos.length ? t('emptyFiltered') : t('emptyAll')}</h3><p>{demos.length ? t('emptyHint') : t('emptyRecordHint')}</p></div>}
        </div>
      </section>
    </div>
    {dialog === 'categories' && <CategoryDialog categories={categories} onClose={() => { setDialog(null); api.demos().then(setDemos).catch(showError) }} onChange={setCategories} onError={showError} />}
    {dialog === 'move' && <MoveDialog categories={categories} count={selected.size} onClose={() => setDialog(null)} onMove={async categoryId => { setBusy(true); try { const updates = await Promise.all(selectedDemos.map(item => api.updateDemo(item.id, { category_id: categoryId || null }))); const map = new Map(updates.map(item => [item.id, item])); setDemos(current => current.map(item => map.get(item.id) || item)); setDialog(null); toast.success(t('messages.moved')) } catch (value) { showError(value) } finally { setBusy(false) } }} />}
    {dialog === 'tags' && <TagDialog tags={tags} demos={tagTargets ?? selectedDemos} onClose={() => { setDialog(null); setTagTargets(null); api.demos().then(setDemos).catch(showError) }} onTags={setTags} onApply={async ids => { const targets = tagTargets ?? selectedDemos; if (!targets.length) { setDialog(null); setTagTargets(null); api.demos().then(setDemos).catch(showError); return } setBusy(true); try { const updates = await Promise.all(targets.map(item => api.updateDemo(item.id, { tag_ids: ids }))); const map = new Map(updates.map(item => [item.id, item])); setDemos(current => current.map(item => map.get(item.id) || item)); setDialog(null); setTagTargets(null); toast.success(targets.length === 1 ? t('messages.demoTagsUpdated', { title: targets[0].title }) : t('messages.tagsUpdated')) } catch (value) { showError(value) } finally { setBusy(false) } }} onError={showError} />}
    {dialog === 'merge' && <MergeDialog demos={selectedDemos} categories={categories} onClose={() => setDialog(null)} onMerge={async (ids, name, categoryId) => { if(!await guard('create_resource'))return;setBusy(true); try { const merged = await api.mergeDemos(ids, name, categoryId); setDemos(current => [merged, ...current]); setSelected(new Set([merged.id])); setDialog(null); void refreshCapabilities(true); toast.success(t('messages.merged', { title: merged.title })) } catch (value) { showError(value) } finally { setBusy(false) } }} />}
    {spaceTransferTarget && <SpaceTransferDialog demo={spaceTransferTarget} busy={busy} onClose={() => setSpaceTransferTarget(null)} onError={showError} onTransfer={async (action, targetOrganizationId) => { setBusy(true); try { const result = await api.transferDemo(spaceTransferTarget.id, action, targetOrganizationId); if (action === 'move') { setDemos(current => current.filter(item => item.id !== spaceTransferTarget.id)); setSelected(current => { const next = new Set(current); next.delete(spaceTransferTarget.id); return next }) } setSpaceTransferTarget(null); void refreshCapabilities(true); toast.success(t(action === 'copy' ? 'messages.copiedToSpace' : 'messages.movedToSpace', { title: result.title })) } catch (value) { showError(value) } finally { setBusy(false) } }} />}
  </main>
}

function DialogShell({ title, subtitle, icon, children, onClose }: { title: string; subtitle: string; icon: 'folder' | 'tag' | 'move'; children: React.ReactNode; onClose: () => void }) {
  return <div className="library-dialog-layer" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="library-dialog"><header><span><Icon name={icon} /></span><div><strong>{title}</strong><small>{subtitle}</small></div><button onClick={onClose}>×</button></header><div className="library-dialog-body">{children}</div></div></div>
}

function CategoryDialog({ categories, onClose, onChange, onError }: { categories: Category[]; onClose: () => void; onChange: (items: Category[]) => void; onError: (value: unknown) => void }) {
  const { t } = useTranslation('dashboard')
  const [name, setName] = useState(''); const [parent, setParent] = useState(''); const [color, setColor] = useState('#635bff'); const [busy, setBusy] = useState(false)
  async function add(event: React.FormEvent) { event.preventDefault(); if (!name.trim()) return; setBusy(true); try { const item = await api.createCategory(name, parent || undefined, color); onChange([...categories, item]); setName('') } catch (value) { onError(value) } finally { setBusy(false) } }
  async function rename(item: Category) { const value = window.prompt(t('categoryDialog.renamePrompt'), item.name)?.trim(); if (!value || value === item.name) return; try { const updated = await api.updateCategory(item.id, { name: value }); onChange(categories.map(value => value.id === item.id ? updated : value)) } catch (error) { onError(error) } }
  async function remove(item: Category) { if (!window.confirm(t('categoryDialog.deleteConfirm', { name: item.name }))) return; try { await api.deleteCategory(item.id); const removed = new Set([item.id, ...categories.filter(value => value.parent_id === item.id).map(value => value.id)]); onChange(categories.filter(value => !removed.has(value.id))) } catch (error) { onError(error) } }
  return <DialogShell title={t('categoryDialog.title')} subtitle={t('categoryDialog.subtitle')} icon="folder" onClose={onClose}><form className="category-create" onSubmit={add}><input value={name} onChange={event => setName(event.target.value)} placeholder={t('categoryDialog.namePlaceholder')} /><select value={parent} onChange={event => setParent(event.target.value)}><option value="">{t('categoryDialog.root')}</option>{categories.filter(item => !item.parent_id).map(item => <option key={item.id} value={item.id}>{t('categoryDialog.childOf', { name: item.name })}</option>)}</select><label className="category-color" title={t('categoryDialog.color')} style={{ background: color }}><input type="color" value={color} onChange={event => setColor(event.target.value)} /></label><button className="primary" disabled={busy || !name.trim()}><Icon name="plus" />{t('common:actions.add')}</button></form><div className="manage-list">{categories.map(item => <div key={item.id} className={item.parent_id ? 'child' : ''}><label className="manage-color" title={t('categoryDialog.changeColor')} style={{ background: item.color }}><input type="color" value={item.color} onChange={async event => { try { const updated = await api.updateCategory(item.id, { color: event.target.value }); onChange(categories.map(value => value.id === item.id ? updated : value)) } catch (error) { onError(error) } }} /></label><span>{item.parent_id ? '↳ ' : ''}{item.name}</span><small>{item.parent_id ? t('categoryDialog.childType') : t('categoryDialog.rootType')}</small><button onClick={() => rename(item)}><Icon name="edit" /></button><button className="danger" onClick={() => remove(item)}><Icon name="delete" /></button></div>)}{!categories.length && <p className="dialog-empty">{t('categoryDialog.empty')}</p>}</div></DialogShell>
}

function MoveDialog({ categories, count, onClose, onMove }: { categories: Category[]; count: number; onClose: () => void; onMove: (id: string) => void }) {
  const { t } = useTranslation('dashboard')
  const [value, setValue] = useState('')
  return <DialogShell title={t('moveDialog.title')} subtitle={t('moveDialog.subtitle', { count })} icon="folder" onClose={onClose}><label>{t('moveDialog.target')}<select value={value} onChange={event => setValue(event.target.value)}><option value="">{t('uncategorized')}</option>{categories.map(item => <option key={item.id} value={item.id}>{item.parent_id ? '　↳ ' : ''}{item.name}</option>)}</select></label><div className="dialog-actions"><button onClick={onClose}>{t('common:actions.cancel')}</button><button className="primary" onClick={() => onMove(value)}>{t('moveDialog.confirm')}</button></div></DialogShell>
}

function TagDialog({ tags, demos, onClose, onTags, onApply, onError }: { tags: Tag[]; demos: Demo[]; onClose: () => void; onTags: (items: Tag[]) => void; onApply: (ids: string[]) => void; onError: (value: unknown) => void }) {
  const { t } = useTranslation('dashboard')
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(demos.length ? demos[0].tags.map(item => item.id) : [])); const [name, setName] = useState(''); const [color, setColor] = useState('#635bff')
  async function add() { if (!name.trim()) return; try { const tag = await api.createTag(name, color); if (!tags.some(item => item.id === tag.id)) onTags([...tags, tag]); setChosen(current => new Set([...current, tag.id])); setName('') } catch (value) { onError(value) } }
  async function removeTag(tag: Tag) { if (!window.confirm(t('tagDialog.deleteConfirm', { name: tag.name }))) return; try { await api.deleteTag(tag.id); onTags(tags.filter(item => item.id !== tag.id)); setChosen(current => { const next = new Set(current); next.delete(tag.id); return next }) } catch (value) { onError(value) } }
  return <DialogShell title={t('tagDialog.title')} subtitle={demos.length ? t('tagDialog.subtitleApply', { count: demos.length }) : t('tagDialog.subtitleManage')} icon="tag" onClose={onClose}><div className="tag-create"><input value={name} onChange={event => setName(event.target.value)} placeholder={t('tagDialog.placeholder')} /><label style={{ background: color }}><input type="color" value={color} onChange={event => setColor(event.target.value)} /></label><button onClick={add}><Icon name="plus" />{t('tagDialog.create')}</button></div><div className="tag-picker">{tags.map(tag => <div className="tag-picker-item" key={tag.id}><button className={chosen.has(tag.id) ? 'active' : ''} onClick={() => setChosen(current => { const next = new Set(current); next.has(tag.id) ? next.delete(tag.id) : next.add(tag.id); return next })}><i style={{ background: tag.color }} />{tag.name}{chosen.has(tag.id) && <Icon name="check" size={13} />}</button>{!demos.length && <button className="tag-delete" title={t('tagDialog.deleteTitle')} onClick={() => removeTag(tag)}><Icon name="delete" size={12} /></button>}</div>)}{!tags.length && <p className="dialog-empty">{t('tagDialog.empty')}</p>}</div><div className="dialog-actions"><button onClick={onClose}>{t('common:actions.cancel')}</button><button className="primary" onClick={() => onApply([...chosen])}>{demos.length ? t('tagDialog.apply') : t('tagDialog.done')}</button></div></DialogShell>
}

function MergeDialog({ demos, categories, onClose, onMerge }: { demos: Demo[]; categories: Category[]; onClose: () => void; onMerge: (ids: string[], name: string, categoryId?: string) => void }) {
  const { t } = useTranslation('dashboard')
  const [items, setItems] = useState(demos); const [name, setName] = useState(t('mergeDialog.defaultName', { title: demos[0]?.title || t('untitled') })); const [category, setCategory] = useState(demos[0]?.category_id || '')
  function move(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; setItems(next) }
  return <DialogShell title={t('mergeDialog.title')} subtitle={t('mergeDialog.subtitle')} icon="move" onClose={onClose}><label>{t('mergeDialog.name')}<input value={name} onChange={event => setName(event.target.value)} maxLength={200} /></label><div className="merge-order"><span>{t('mergeDialog.order')}</span>{items.map((item, index) => <div key={item.id}><b>{index + 1}</b>{item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : <span className="merge-thumb"><Icon name="image" /></span>}<div><strong>{item.title}</strong><small>{item.steps.length ? t('common:units.steps', { count: item.steps.length }) : t('mergeDialog.validateSteps')}</small></div><button disabled={!index} onClick={() => move(index, -1)}><Icon name="arrowUp" /></button><button disabled={index === items.length - 1} onClick={() => move(index, 1)}><Icon name="arrowDown" /></button></div>)}</div><label>{t('mergeDialog.category')}<select value={category} onChange={event => setCategory(event.target.value)}><option value="">{t('mergeDialog.categoryDefault')}</option>{categories.map(item => <option key={item.id} value={item.id}>{item.parent_id ? '　↳ ' : ''}{item.name}</option>)}</select></label><div className="dialog-actions"><button onClick={onClose}>{t('common:actions.cancel')}</button><button className="primary" disabled={!name.trim()} onClick={() => onMerge(items.map(item => item.id), name, category || undefined)}><Icon name="move" />{t('mergeDialog.submit')}</button></div></DialogShell>
}
