import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import AdminPagination from '../components/AdminPagination'
import { formatDate, normalizeLocale } from '../i18n'
import type { RecycleItem } from '../types'

export default function AdminRecycle() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<RecycleItem[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10)
  const load = () => { setLoading(true); return api.recycleBin().then(setItems).catch(value => setError(value.message)).finally(() => setLoading(false)) }
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
        <td><div className="recycle-actions"><button className="secondary icon-button" disabled={busy === item.id} onClick={() => restore(item)}>{busy === item.id ? <span className="action-spinner" /> : <Icon name="arrowUp" />}{t('recycle.restore')}</button><button className="danger icon-button" disabled={busy === item.id} onClick={() => purge(item)}><Icon name="delete" />{t('recycle.purge')}</button></div></td>
      </tr>)}</tbody></table>
        {loading && <div className="admin-table-state"><span className="action-spinner" />{t('loading')}</div>}
        {!loading && !items.length && <div className="recycle-empty"><span className="recycle-empty-icon"><Icon name="delete" size={28} /></span><strong>{t('recycle.empty')}</strong><p>{t('recycle.subtitle')}</p></div>}
      </div>
      {!!items.length && <AdminPagination page={page} pageSize={pageSize} total={items.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />}
    </section>
  </div>
}
