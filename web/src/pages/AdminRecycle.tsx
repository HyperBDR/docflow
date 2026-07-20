import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import AdminPagination from '../components/AdminPagination'
import { formatDate, normalizeLocale } from '../i18n'
import type { RecycleItem } from '../types'

function bytes(value: number | undefined, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminRecycle() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<RecycleItem[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<RecycleItem | null>(null)
  const load = () => { setLoading(true); return api.recycleBin().then(value => { setItems(value); setSelected(current => value.find(item => item.id === current?.id && item.item_type === current.item_type) || null) }).catch(value => setError(value.message)).finally(() => setLoading(false)) }
  useEffect(() => { void load() }, [])
  useEffect(() => { if (page > Math.max(1, Math.ceil(items.length / pageSize))) setPage(1) }, [items.length, page, pageSize])

  async function restore(item: RecycleItem) {
    setBusy(item.id); setError('')
    try { await api.restoreRecycleItem(item); await load() }
    catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  async function purge(item: RecycleItem) {
    if (!confirm(t('recycle.purgeConfirm', { title: item.title }))) return
    setBusy(item.id)
    try {
      item.item_type === 'resource' ? await api.purgeResource(item.id) : item.item_type === 'team_space' ? await api.purgeTeamSpace(item.id) : await api.purgeUser(item.id)
      await load()
    } catch (value) { setError(value instanceof Error ? value.message : t('common:errors.operationFailed')) }
    finally { setBusy('') }
  }

  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
  const preview = selected?.preview || {}

  return <div className="admin-content-page">
    <div className="admin-page-intro"><div><h1>{t('recycle.title')}</h1><p>{t('recycle.subtitle')}</p></div><span>{t('recycle.total', { count: items.length })}</span></div>
    {error && <div className="error">{error}</div>}
    <section className="admin-list-card recycle-list-card">
      <div className="recycle-table-wrap"><table className="recycle-table"><thead><tr><th>{t('recycle.columns.item')}</th><th>{t('recycle.columns.type')}</th><th>{t('recycle.columns.owner')}</th><th>{t('recycle.columns.deletedBy')}</th><th>{t('recycle.columns.deletedAt')}</th><th>{t('recycle.columns.expiresAt')}</th><th>{t('recycle.columns.actions')}</th></tr></thead><tbody>{pageItems.map(item => <tr key={`${item.item_type}-${item.id}`}>
        <td><div className="recycle-item-name"><span className={item.item_type}><Icon name={item.item_type === 'user' ? 'user' : item.item_type === 'team_space' ? 'users' : 'folder'} /></span><strong title={item.title}>{item.title}</strong></div></td>
        <td><span className={`recycle-type-label ${item.item_type}`}>{t(`recycle.types.${item.item_type}`)}</span></td>
        <td><span className="recycle-cell-text" title={item.owner_email}>{item.owner_email || '—'}</span></td>
        <td><span className="recycle-cell-text" title={item.deleted_by_name}>{item.deleted_by_name || '—'}</span></td>
        <td><time>{formatDate(item.deleted_at, locale)}</time></td><td><time>{formatDate(item.expires_at, locale)}</time></td>
        <td><div className="recycle-actions"><button className="icon-button" disabled={busy === item.id} onClick={() => setSelected(item)}><Icon name="eye" />{t('recycle.preview')}</button><button className="secondary icon-button" disabled={busy === item.id} onClick={() => restore(item)}>{busy === item.id ? <span className="action-spinner" /> : <Icon name="arrowUp" />}{t('recycle.restore')}</button><button className="danger icon-button" disabled={busy === item.id} onClick={() => purge(item)}><Icon name="delete" />{t('recycle.purge')}</button></div></td>
      </tr>)}</tbody></table>
        {loading && <div className="admin-table-state"><span className="action-spinner" />{t('loading')}</div>}
        {!loading && !items.length && <div className="recycle-empty"><span className="recycle-empty-icon"><Icon name="delete" size={28} /></span><strong>{t('recycle.empty')}</strong><p>{t('recycle.subtitle')}</p></div>}
      </div>
      {!!items.length && <AdminPagination page={page} pageSize={pageSize} total={items.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />}
    </section>
    {selected && <><button className="admin-user-drawer-scrim" aria-label={t('common:actions.close')} onClick={() => setSelected(null)} /><aside className="admin-user-drawer admin-detail-drawer recycle-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="recycle-detail-title"><header className="admin-user-drawer-header"><div className="admin-detail-identity recycle-detail-identity"><span className={selected.item_type}><Icon name={selected.item_type === 'user' ? 'user' : selected.item_type === 'team_space' ? 'users' : 'folder'} size={22} /></span><div><h2 id="recycle-detail-title">{selected.title}</h2><p>{t(`recycle.types.${selected.item_type}`)} · {selected.owner_email || '—'}</p><div className="admin-user-meta"><em>{t('recycle.details.deleted')}</em><small>{formatDate(selected.deleted_at, locale)}</small></div></div></div><button className="admin-user-drawer-close" aria-label={t('common:actions.close')} onClick={() => setSelected(null)}>×</button></header><div className="admin-user-drawer-body admin-detail-body">
      {selected.item_type === 'resource' && <section className="admin-detail-card recycle-resource-preview">{selected.thumbnail_url ? <img src={selected.thumbnail_url} alt="" /> : <div className="recycle-preview-placeholder"><Icon name="image" size={34} /></div>}<div><h3>{selected.title}</h3><p>{preview.description || t('recycle.details.noDescription')}</p></div></section>}
      <section className="admin-detail-card"><header><div><strong>{t('recycle.details.summary')}</strong><small>{t('recycle.details.summaryHint')}</small></div></header><div className="recycle-detail-grid">
        {selected.item_type === 'resource' && <><div><small>{t('recycle.details.teamSpace')}</small><strong>{preview.organization_name || '—'}</strong></div><div><small>{t('recycle.details.status')}</small><strong>{t(`common:status.${preview.status}`, { defaultValue: preview.status || '—' })}</strong></div><div><small>{t('detail.steps')}</small><strong>{preview.step_count || 0}</strong></div><div><small>{t('detail.views')}</small><strong>{preview.views || 0}</strong></div><div><small>{t('detail.storage')}</small><strong>{bytes(preview.storage_bytes, locale)}</strong></div><div><small>{t('detail.language')}</small><strong>{preview.content_locale === 'en' ? 'English' : '简体中文'}</strong></div></>}
        {selected.item_type === 'user' && <><div><small>{t('recycle.details.email')}</small><strong>{preview.email || selected.owner_email}</strong></div><div><small>{t('recycle.details.role')}</small><strong>{t(`roles.${preview.role}`, { defaultValue: preview.role || '—' })}</strong></div><div><small>{t('recycle.details.teams')}</small><strong>{preview.team_count || 0}</strong></div><div><small>{t('recycle.details.resources')}</small><strong>{preview.resource_count || 0}</strong></div><div><small>{t('detail.storage')}</small><strong>{bytes(preview.storage_bytes, locale)}</strong></div></>}
        {selected.item_type === 'team_space' && <><div><small>{t('recycle.details.slug')}</small><code>{preview.slug || '—'}</code></div><div><small>{t('recycle.details.owner')}</small><strong>{preview.owner_name || selected.owner_email || '—'}</strong></div><div><small>{t('recycle.details.members')}</small><strong>{preview.member_count || 0}</strong></div><div><small>{t('recycle.details.resources')}</small><strong>{preview.resource_count || 0}</strong></div></>}
        <div><small>{t('recycle.details.createdAt')}</small><strong>{preview.created_at ? formatDate(preview.created_at, locale) : '—'}</strong></div>{preview.updated_at && <div><small>{t('recycle.details.updatedAt')}</small><strong>{formatDate(preview.updated_at, locale)}</strong></div>}
      </div></section>
      <section className="admin-detail-card"><header><div><strong>{t('recycle.details.deletion')}</strong><small>{t('recycle.details.deletionHint')}</small></div></header><div className="recycle-deletion-grid"><div><small>{t('recycle.details.deletedBy')}</small><strong>{selected.deleted_by_name || '—'}</strong></div><div><small>{t('recycle.details.deletedAt')}</small><strong>{formatDate(selected.deleted_at, locale)}</strong></div><div><small>{t('recycle.details.purgeAt')}</small><strong>{formatDate(selected.expires_at, locale)}</strong></div></div></section>
    </div><footer className="recycle-detail-actions"><button className="secondary icon-button" disabled={busy === selected.id} onClick={() => restore(selected)}>{busy === selected.id ? <span className="action-spinner" /> : <Icon name="arrowUp" />}{t('recycle.restore')}</button><button className="danger icon-button" disabled={busy === selected.id} onClick={() => purge(selected)}><Icon name="delete" />{t('recycle.purge')}</button></footer></aside></>}
  </div>
}
