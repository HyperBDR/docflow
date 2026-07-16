import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import Icon from '../components/Icon'
import AdminPagination from '../components/AdminPagination'
import { formatDate, formatNumber, normalizeLocale } from '../i18n'
import type { AdminResource, AdminUser, Locale } from '../types'

function bytes(value: number, locale: string) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${units[index]}`
}

export default function AdminResources() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<AdminResource[]>([])
  const [owners, setOwners] = useState<AdminUser[]>([])
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState('')
  const [status, setStatus] = useState<'' | 'draft' | 'published'>('')
  const [contentLocale, setContentLocale] = useState<'' | Locale>('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => { api.adminUsers({ page_size: 100 }).then(value => setOwners(value.items)).catch(() => undefined) }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      api.adminResources({ query, owner_id: owner, status, content_locale: contentLocale, page, page_size: pageSize })
        .then(value => { setItems(value.items); setTotal(value.total) })
        .catch(value => setError(value.message)).finally(() => setLoading(false))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [query, owner, status, contentLocale, page, pageSize])
  const resetPage = <T,>(setter: (value: T) => void, value: T) => { setter(value); setPage(1) }
  return <div className="admin-content-page">
    <div className="admin-page-intro"><div><h1>{t('resource.title')}</h1><p>{t('resource.subtitle')}</p></div><span>{t('resource.total', { count: total })}</span></div>
    <section className="admin-list-card">
      <div className="resource-filters">
        <label className="admin-search"><Icon name="search" /><input value={query} onChange={event => resetPage(setQuery, event.target.value)} placeholder={t('resource.search')} /></label>
        <select value={owner} onChange={event => resetPage(setOwner, event.target.value)}><option value="">{t('resource.allOwners')}</option>{owners.map(item => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select>
        <select value={status} onChange={event => resetPage(setStatus, event.target.value as typeof status)}><option value="">{t('resource.allStatuses')}</option><option value="published">{t('common:status.published')}</option><option value="draft">{t('common:status.draft')}</option></select>
        <select value={contentLocale} onChange={event => resetPage(setContentLocale, event.target.value as typeof contentLocale)}><option value="">{t('resource.allLanguages')}</option><option value="zh-CN">{t('common:language.zh-CN')}</option><option value="en">{t('common:language.en')}</option></select>
      </div>
      {error && <div className="error admin-list-error">{error}</div>}
      <div className="admin-resource-table-wrap"><table className="admin-resource-table"><thead><tr><th>{t('resource.table.resource')}</th><th>{t('resource.table.owner')}</th><th>{t('resource.table.status')}</th><th>{t('resource.table.steps')}</th><th>{t('resource.table.views')}</th><th>{t('resource.table.storage')}</th><th>{t('resource.table.updated')}</th><th /></tr></thead><tbody>
        {items.map(item => <tr key={item.id}><td><Link className="resource-name-cell" to={`/admin/resources/${item.id}`}><span>{item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : <Icon name="image" />}</span><div><strong>{item.title}</strong><small>{item.content_locale === 'en' ? 'English' : '简体中文'}</small></div></Link></td><td><div className="resource-owner-cell"><strong>{item.owner.name || item.owner.email.split('@')[0]}</strong><small>{item.owner.email}</small></div></td><td><span className={`status ${item.status}`}>{t(`common:status.${item.status}`)}</span></td><td>{formatNumber(item.step_count, locale)}</td><td>{formatNumber(item.views, locale)}</td><td>{bytes(item.storage_bytes, locale)}</td><td><small>{formatDate(item.updated_at, locale)}</small></td><td><Link className="table-open-action" to={`/admin/resources/${item.id}`} aria-label={t('common:actions.open')}><Icon name="chevronRight" /></Link></td></tr>)}
      </tbody></table>{loading && <div className="admin-table-state"><span className="action-spinner" />{t('loading')}</div>}{!loading && !items.length && <div className="admin-table-state"><Icon name="folder" size={28} />{t('resource.empty')}</div>}</div>
      <AdminPagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />
    </section>
  </div>
}
