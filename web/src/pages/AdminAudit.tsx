import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import AdminPagination from '../components/AdminPagination'
import Icon from '../components/Icon'
import { formatDate, normalizeLocale } from '../i18n'
import type { AuditLog } from '../types'

function ChangeSet({ item }: { item: AuditLog }) {
  const { t } = useTranslation('admin')
  const before = Object.entries(item.before || {}), after = Object.entries(item.after || {})
  if (!before.length && !after.length) return <span>—</span>
  return <details className="audit-change"><summary>{t('audit.viewChanges')}</summary><div><section><b>{t('audit.before')}</b><pre>{JSON.stringify(item.before, null, 2)}</pre></section><section><b>{t('audit.after')}</b><pre>{JSON.stringify(item.after, null, 2)}</pre></section></div></details>
}

export default function AdminAudit() {
  const { t, i18n } = useTranslation(['admin', 'common']); const locale = normalizeLocale(i18n.language)
  const [items, setItems] = useState<AuditLog[]>([]), [query, setQuery] = useState(''), [type, setType] = useState(''), [source, setSource] = useState(''), [outcome, setOutcome] = useState('')
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [total, setTotal] = useState(0), [loading, setLoading] = useState(true)
  useEffect(() => { const timer = window.setTimeout(() => { setLoading(true); api.auditLogs({ query, target_type: type, source, outcome, page, page_size: pageSize }).then(value => { setItems(value.items); setTotal(value.total) }).finally(() => setLoading(false)) }, 200); return () => clearTimeout(timer) }, [query, type, source, outcome, page, pageSize])
  return <div className="admin-content-page"><div className="admin-page-intro"><div><h1>{t('audit.title')}</h1><p>{t('audit.subtitle')}</p></div><span>{t('audit.total', { count: total })}</span></div><section className="admin-list-card"><div className="audit-filters"><label className="admin-search"><Icon name="search" /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder={t('audit.search')} /></label><select value={type} onChange={event => { setType(event.target.value); setPage(1) }}><option value="">{t('audit.allTypes')}</option>{['user', 'recording', 'resource', 'organization', 'member', 'invitation', 'ai_settings', 'ai_model'].map(value => <option value={value} key={value}>{t(`audit.types.${value}`)}</option>)}</select><select value={source} onChange={event => { setSource(event.target.value); setPage(1) }}><option value="">{t('audit.allSources')}</option>{['web','extension','admin','system'].map(value => <option key={value} value={value}>{t(`audit.sources.${value}`)}</option>)}</select><select value={outcome} onChange={event => { setOutcome(event.target.value); setPage(1) }}><option value="">{t('audit.allOutcomes')}</option>{['success','failed','blocked'].map(value => <option key={value} value={value}>{t(`audit.outcomes.${value}`)}</option>)}</select></div>
    <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>{t('audit.columns.action')}</th><th>{t('audit.columns.target')}</th><th>{t('audit.columns.actor')}</th><th>{t('audit.columns.context')}</th><th>{t('audit.columns.origin')}</th><th>{t('audit.columns.changes')}</th><th>{t('audit.columns.time')}</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{t(`audit.actions.${item.action}`, { defaultValue: item.action })}</strong><small>{t(`audit.types.${item.target_type}`, { defaultValue: item.target_type })}</small></td><td>{item.target_label || item.target_id}</td><td><strong>{item.actor_name || item.actor_email || t('audit.system')}</strong><small>{item.actor_email}</small></td><td><strong>{item.organization_name || '—'}</strong><small className={`audit-outcome ${item.outcome}`}>{t(`audit.outcomes.${item.outcome}`, { defaultValue: item.outcome })}</small></td><td><code>{item.ip_address || '—'}</code><small>{t(`audit.sources.${item.source}`, { defaultValue: item.source })}</small><details><summary>{t('audit.client')}</summary><p>{item.user_agent || '—'}</p></details></td><td><ChangeSet item={item} /></td><td><time>{formatDate(item.created_at, locale)}</time></td></tr>)}</tbody></table>{loading && <div className="admin-table-state"><span className="action-spinner" />{t('loading')}</div>}{!loading && !items.length && <div className="admin-table-state">{t('audit.empty')}</div>}</div>
    <AdminPagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} /></section></div>
}
