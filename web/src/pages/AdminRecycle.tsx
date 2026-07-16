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

  return <div className="admin-content-page">
    <div className="admin-page-intro"><div><h1>{t('recycle.title')}</h1><p>{t('recycle.subtitle')}</p></div><span>{t('recycle.total', { count: items.length })}</span></div>
    {error && <div className="error">{error}</div>}
    <section className={`recycle-grid ${!items.length ? 'is-empty' : ''}`}>{items.slice((page - 1) * pageSize, page * pageSize).map(item => <article key={`${item.item_type}-${item.id}`}>
      <span className={item.item_type}><Icon name={item.item_type === 'user' ? 'user' : item.item_type === 'team_space' ? 'users' : 'folder'} /></span>
      <div><strong>{item.title}</strong><span className="recycle-type-label">{t(`recycle.types.${item.item_type}`)}</span><small>{item.owner_email}</small><p>{t('recycle.deletedAt', { date: formatDate(item.deleted_at, locale) })}</p><p>{t('recycle.expiresAt', { date: formatDate(item.expires_at, locale) })}</p></div>
      <div><button className="secondary icon-button" disabled={busy === item.id} onClick={() => restore(item)}><Icon name="arrowUp" />{t('recycle.restore')}</button><button className="danger icon-button" disabled={busy === item.id} onClick={() => purge(item)}><Icon name="delete" />{t('recycle.purge')}</button></div>
    </article>)}{loading && !items.length ? <div className="empty"><span className="action-spinner" /><p>{t('loading')}</p></div> : !items.length && <div className="empty"><span className="recycle-empty-icon"><Icon name="delete" size={28} /></span><strong>{t('recycle.empty')}</strong><p>{t('recycle.subtitle')}</p></div>}</section>
    {!!items.length && <AdminPagination page={page} pageSize={pageSize} total={items.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />}
  </div>
}
